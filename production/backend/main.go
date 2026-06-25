package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/grafana/pyroscope-go"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/stdout/stdoutmetric"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/plugin/opentelemetry/tracing"
)

// --- SQLMODEL (GORM) DEFINITIONS ---
type Item struct {
	ID          uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	Title       string `gorm:"index" json:"title"`
	Description string `json:"description"`
}

type ItemCreate struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
}

// Global Variables
var (
	db                  *gorm.DB
	tracer              trace.Tracer
	itemsCreatedCounter metric.Int64Counter
)

func main() {
	ctx := context.Background()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// --- 1. PROFILING (Pyroscope Graceful Degradation) ---
	pyroscopeServer := getEnv("PYROSCOPE_SERVER", "http://pyroscope:4040")
	if !strings.Contains(pyroscopeServer, "?format=") {
		pyroscopeServer = strings.TrimRight(pyroscopeServer, "/") + "?format=pyroscope"
	}

	_, err := pyroscope.Start(pyroscope.Config{
		ApplicationName: "backend",
		ServerAddress:   pyroscopeServer,
		Logger:          pyroscope.StandardLogger,
		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocObjects,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileInuseObjects,
			pyroscope.ProfileInuseSpace,
		},
	})
	if err != nil {
		slog.Warn("Pyroscope initialization failed, degrading gracefully", "error", err)
	}

	// --- 2. TRACING & METRICS SETUP ---
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("backend"),
			semconv.ServiceVersion("1.0.0"),
		),
	)
	if err != nil {
		slog.Error("Failed to create OpenTelemetry resource", "error", err)
	}

	enableObservability := strings.ToLower(getEnv("ENABLE_OBSERVABILITY", "false")) == "true"
	var traceExporter sdktrace.SpanExporter
	var metricExporter sdkmetric.Exporter

	if enableObservability {
		traceExporter, _ = otlptracegrpc.New(ctx)
		metricExporter, _ = otlpmetricgrpc.New(ctx)
	} else {
		traceExporter, _ = stdouttrace.New(stdouttrace.WithPrettyPrint())
		metricExporter, _ = stdoutmetric.New()
	}

	// Sample only 10% of traffic (0.1)
	bsp := sdktrace.NewBatchSpanProcessor(traceExporter)
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.TraceIDRatioBased(0.1)),
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(bsp),
	)
	otel.SetTracerProvider(tracerProvider)
	tracer = otel.Tracer("cloud_native_backend")

	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),
	)
	otel.SetMeterProvider(meterProvider)
	meter := otel.Meter("cloud_native_backend")

	itemsCreatedCounter, _ = meter.Int64Counter(
		"items_created_total",
		metric.WithDescription("Total number of items successfully created"),
	)

	// --- 3. DATABASE CONFIGURATION (PostgreSQL) ---
	dsn := getEnv("DATABASE_URL", "host=postgres user=postgres password=postgres dbname=postgres port=5432 sslmode=disable")
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: true, // Caches prepared statements for performance
	})
	if err != nil {
		slog.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}

	// Instrument GORM with OpenTelemetry
	if err := db.Use(tracing.NewPlugin(tracing.WithoutMetrics())); err != nil {
		slog.Error("Failed to initialize DB tracing", "error", err)
	}

	// Connection Pooling
	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxIdleConns(10)
		sqlDB.SetMaxOpenConns(100)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	slog.Info("Initializing database and tables...")
	db.AutoMigrate(&Item{})

	// --- 4. FASTAPI (GIN) INITIALIZATION ---
	gin.SetMode(gin.ReleaseMode)
	app := gin.New()
	app.Use(gin.Recovery())

	// Production Security Headers
	app.Use(func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Content-Security-Policy", "default-src 'self'")
		c.Next()
	})

	// Custom logging middleware to filter health probes
	app.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path != "/healthz" && path != "/readyz" {
			gin.Logger()(c)
		} else {
			c.Next()
		}
	})

	// OpenTelemetry Gin Middleware
	app.Use(otelgin.Middleware("backend", otelgin.WithFilter(func(req *http.Request) bool {
		path := req.URL.Path
		return path != "/healthz" && path != "/readyz" && path != "/metrics"
	})))

	allowedOrigin := getEnv("ALLOWED_ORIGIN", "http://localhost:8000")
	app.Use(cors.New(cors.Config{
		AllowOrigins:     []string{allowedOrigin},
		AllowMethods:     []string{"*"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"traceparent", "tracestate"},
		AllowCredentials: true,
	}))

	// --- 5. PROBES & ROUTING ---
	app.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "alive"})
	})

	app.GET("/readyz", func(c *gin.Context) {
		sqlDB, err := db.DB()
		if err != nil || sqlDB.Ping() != nil {
			slog.Error("Readiness probe failed database check")
			c.JSON(http.StatusServiceUnavailable, gin.H{"detail": "Database unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	app.POST("/items", createItem)
	app.GET("/items", readItems)
	app.PUT("/items/:id", updateItem)
	app.DELETE("/items/:id", deleteItem)

	// --- 6. LIFESPAN MANAGEMENT (Graceful Shutdown) ---
	srv := &http.Server{
		Addr:    ":8000",
		Handler: app,
	}

	go func() {
		slog.Info("Server listening on :8000")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server listen failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Application shutting down. Flushing telemetry data...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	_ = tracerProvider.Shutdown(shutdownCtx)
	_ = meterProvider.Shutdown(shutdownCtx)
	slog.Info("Shutdown complete")
}

// --- CONTROLLERS ---

func createItem(c *gin.Context) {
	var itemCreate ItemCreate
	if err := c.ShouldBindJSON(&itemCreate); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	dbItem := Item{
		Title:       itemCreate.Title,
		Description: itemCreate.Description,
	}

	db.WithContext(c.Request.Context()).Create(&dbItem)

	itemsCreatedCounter.Add(c.Request.Context(), 1, metric.WithAttributes(
		attribute.String("status", "success"),
	))
	slog.Info("Successfully created new item", "id", dbItem.ID)

	c.JSON(http.StatusCreated, dbItem)
}

func readItems(c *gin.Context) {
	skip, _ := strconv.Atoi(c.DefaultQuery("skip", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))

	ctx, span := tracer.Start(c.Request.Context(), "fetch_all_items_from_db")
	defer span.End()

	var items []Item
	db.WithContext(ctx).Offset(skip).Limit(limit).Find(&items)

	span.SetAttributes(attribute.Int("items.count", len(items)))
	c.JSON(http.StatusOK, items)
}

func updateItem(c *gin.Context) {
	id := c.Param("id")
	var dbItem Item

	if err := db.WithContext(c.Request.Context()).First(&dbItem, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Warn("Update failed. Item not found.", "id", id)
			c.JSON(http.StatusNotFound, gin.H{"detail": "Item not found"})
			return
		}
	}

	var itemUpdate ItemCreate
	if err := c.ShouldBindJSON(&itemUpdate); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	dbItem.Title = itemUpdate.Title
	dbItem.Description = itemUpdate.Description

	db.WithContext(c.Request.Context()).Save(&dbItem)
	c.JSON(http.StatusOK, dbItem)
}

func deleteItem(c *gin.Context) {
	id := c.Param("id")
	var dbItem Item

	if err := db.WithContext(c.Request.Context()).First(&dbItem, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Warn("Delete failed. Item not found.", "id", id)
			c.JSON(http.StatusNotFound, gin.H{"detail": "Item not found"})
			return
		}
	}

	db.WithContext(c.Request.Context()).Delete(&dbItem)
	c.Status(http.StatusNoContent)
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

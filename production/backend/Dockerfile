# stage 1: build the binary using Debian 13 (Trixie)
FROM golang:1.26.4-trixie as builder
WORKDIR /app

# install dependencies
COPY go.mod go.sum ./
RUN go mod download

# copy source code and compile
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /go-backend .

# stage 2: matching minimal production image (Debian 13 based)
FROM gcr.io/distroless/base-debian13@sha256:ab7554b6d07ad354fad31957f8a1a813e65dfb93a8ad160568c79c3f2be6884f

COPY --from=builder /go-backend /go-backend

USER nonroot:nonroot

EXPOSE 8000

ENTRYPOINT ["/go-backend"]
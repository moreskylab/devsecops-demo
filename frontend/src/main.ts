import './style.css';
// ==========================================
// OPENTELEMETRY INITIALIZATION (Must be first)
// ==========================================
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// --- NEW LOGGING IMPORTS ---
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

// --- NEW METRICS IMPORTS ---
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

const API_URL = '/items';
const finalOtlpUrl = '/v1/traces';
const finalLogsUrl = '/v1/logs'; // Added logs endpoint
const finalMetricsUrl = '/v1/metrics'; // Added metrics endpoint


// --- TELEMETRY SYSTEM REGISTRATION ---
const telemetryResource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'frontend',
    [ATTR_SERVICE_VERSION]: '1.0.0',
});

const exporter = new OTLPTraceExporter({
    url: finalOtlpUrl,
});

// Pass the batch processing mechanics during class instantiation
const provider = new WebTracerProvider({ 
    resource: telemetryResource,
    spanProcessors: [new BatchSpanProcessor(exporter)] 
});

// Safely register global propagation layer handlers
provider.register({
    propagator: new W3CTraceContextPropagator(),
});


// --- NEW LOGGING SETUP ---
const logExporter = new OTLPLogExporter({
    url: finalLogsUrl,
});

// Pass the processor array via the 'processors' configuration key
const loggerProvider = new LoggerProvider({
    resource: telemetryResource,
    processors: [new BatchLogRecordProcessor(logExporter)] // Fixed parameter name
});

// Register the logger provider globally
logs.setGlobalLoggerProvider(loggerProvider);

// Initialize the logger instance
const logger = logs.getLogger('frontend-logger', '1.0.0');


// --- METRICS SETUP ---
const metricExporter = new OTLPMetricExporter({ url: finalMetricsUrl });
const meterProvider = new MeterProvider({
    resource: telemetryResource,
    readers: [
        new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis: 60000, 
        }),
    ],
});

metrics.setGlobalMeterProvider(meterProvider);
const meter = metrics.getMeter('frontend-main-meter', '1.0.0');

// --- FIXED: Added export keywords so TypeScript knows these instruments are used ---
export const itemCreationCounter = meter.createCounter('items.created.count', {
    description: 'Tracks the total number of items created',
});

export const operationDurationHistogram = meter.createHistogram('ui.operation.duration', {
    description: 'Tracks durations of frontend operations',
    unit: 'ms',
});

// ==========================================
// APPLICATION LOGIC
// ==========================================

interface Item {
    id: number;
    title: string;
    description: string | null;
}

// registerInstrumentations({
//     instrumentations: [
//         new FetchInstrumentation({
//             propagateTraceHeaderCorsUrls: [ /.*/ ],
//         }),
//         new UserInteractionInstrumentation({
//             eventNames: ['click', 'submit'],
//         }),
//     ],
// });

registerInstrumentations({
    instrumentations: [
        new FetchInstrumentation({
            // ONLY propagate headers to your actual backend domain
            propagateTraceHeaderCorsUrls: [ /.*upward-snipping-certainty\.ngrok-free\.dev.*/ ],
            
            // IGNORE static assets and irrelevant APIs
            ignoreUrls: [
                /\.(css|js|png|jpg|jpeg|svg|woff|woff2)$/, 
                /google-analytics\.com/
            ],
        }),
        new UserInteractionInstrumentation({
            eventNames: ['click', 'submit'],
        }),
    ],
});


const tracer = trace.getTracer('frontend-tracer', '1.0.0');

const itemForm = document.getElementById('item-form') as HTMLFormElement | null;
const itemIdInput = document.getElementById('item-id') as HTMLInputElement | null;
const itemTitleInput = document.getElementById('item-title') as HTMLInputElement | null;
const itemDescInput = document.getElementById('item-desc') as HTMLInputElement | null;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;
const itemsList = document.getElementById('items-list') as HTMLUListElement | null;

let isEditing = false;
let localItemsCache: Item[] = []; // OPTIMIZATION: Cache items locally for event delegation

if (!itemForm || !itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn || !itemsList) {
    const errorMsg = "Required DOM elements missing from the page.";
    logger.emit({
        severityNumber: SeverityNumber.FATAL,
        severityText: 'FATAL',
        body: errorMsg,
        attributes: { component: 'dom_initialization' }
    });
    throw new Error(errorMsg);
}

async function fetchItems(): Promise<void> {
    const startTime = performance.now();
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        localItemsCache = await response.json(); // Update cache
        renderItems(localItemsCache);
        
        logger.emit({
            severityNumber: SeverityNumber.INFO,
            severityText: 'INFO',
            body: 'Successfully fetched items list',
            attributes: { count: localItemsCache.length }
        });
        
        operationDurationHistogram.record(performance.now() - startTime, { 
            operation: 'fetchItems', 
            status: 'success' 
        });
    } catch (err) {
        const errorInstance = err as Error;
        logger.emit({
            severityNumber: SeverityNumber.ERROR,
            severityText: 'ERROR',
            body: `Failed fetching records: ${errorInstance.message}`,
            attributes: { error_type: errorInstance.name }
        });
        
        operationDurationHistogram.record(performance.now() - startTime, { 
            operation: 'fetchItems', 
            status: 'error' 
        });
    }
}

async function saveItem(e: Event): Promise<void> {
    e.preventDefault();
    if (!itemIdInput || !itemTitleInput || !itemDescInput) return;

    const id = itemIdInput.value;
    const payload = {
        title: itemTitleInput.value.trim(),
        description: itemDescInput.value.trim() || null
    };

    if (!payload.title) {
        logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: 'WARN',
            body: 'Item submission rejected: title empty',
        });
        return;
    }

    const url = isEditing && id ? `${API_URL}/${id}` : API_URL;
    const method = isEditing && id ? 'PUT' : 'POST';
    const startTime = performance.now();

    await tracer.startActiveSpan('ui.submit_item', async (span) => {
        try {
            span.setAttribute('item.action', method);
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            resetForm();
            await fetchItems();
            span.setStatus({ code: SpanStatusCode.OK });

            if (method === 'POST') {
                itemCreationCounter.add(1, { status: 'success' });
            }

            operationDurationHistogram.record(performance.now() - startTime, { 
                operation: 'saveItem', 
                method: method, 
                status: 'success' 
            });

            logger.emit({
                severityNumber: SeverityNumber.INFO,
                severityText: 'INFO',
                body: `Successfully saved item payload`,
                attributes: { action: method, item_id: id || 'new' }
            });
        } catch (err) {
            const errorInstance = err as Error;
            span.recordException(errorInstance);
            span.setStatus({ code: SpanStatusCode.ERROR, message: errorInstance.message });
            
            operationDurationHistogram.record(performance.now() - startTime, { 
                operation: 'saveItem', 
                method: method, 
                status: 'error' 
            });

            logger.emit({
                severityNumber: SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: `Failed saving payload: ${errorInstance.message}`,
                attributes: { action: method, item_id: id || 'new' }
            });
        } finally {
            span.end();
        }
    });
}

async function deleteItem(id: number): Promise<void> {
    if (!window.confirm("Delete this item?")) return;
    const startTime = performance.now();
    
    await tracer.startActiveSpan('ui.delete_item', async (span) => {
        try {
            span.setAttribute('item.id', id);
            const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            await fetchItems();
            span.setStatus({ code: SpanStatusCode.OK });

            operationDurationHistogram.record(performance.now() - startTime, { 
                operation: 'deleteItem', 
                status: 'success' 
            });

            logger.emit({
                severityNumber: SeverityNumber.INFO,
                severityText: 'INFO',
                body: `Successfully dropped record`,
                attributes: { item_id: id }
            });
        } catch (err) {
            const errorInstance = err as Error;
            span.recordException(errorInstance);
            span.setStatus({ code: SpanStatusCode.ERROR, message: errorInstance.message });
            
            operationDurationHistogram.record(performance.now() - startTime, { 
                operation: 'deleteItem', 
                status: 'error' 
            });

            logger.emit({
                severityNumber: SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: `Failed dropping record: ${errorInstance.message}`,
                attributes: { item_id: id }
            });
        } finally {
            span.end();
        }
    });
}

function renderItems(items: Item[]): void {
    if (!itemsList) return;
    const startTime = performance.now();
    
    tracer.startActiveSpan('ui.render_list', (span) => {
        span.setAttribute('items.count', items.length);
        const fragment = document.createDocumentFragment();

        items.forEach(item => {
            const li = document.createElement('li');
            const contentDiv = document.createElement('div');
            const titleSpan = document.createElement('strong');
            titleSpan.textContent = item.title;
            contentDiv.appendChild(titleSpan);
            
            if (item.description) {
                contentDiv.appendChild(document.createTextNode(` - ${item.description}`));
            }
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'actions';

            // OPTIMIZATION: Added data attributes for event delegation and explicit type="button"
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.textContent = 'Edit';
            editBtn.dataset.action = 'edit';
            editBtn.dataset.id = item.id.toString();

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.textContent = 'Delete';
            delBtn.className = 'delete-btn';
            delBtn.dataset.action = 'delete';
            delBtn.dataset.id = item.id.toString();

            actionsDiv.append(editBtn, delBtn);
            li.append(contentDiv, actionsDiv);
            fragment.appendChild(li);
        });

        // OPTIMIZATION: replaceChildren is significantly faster and safer than textContent = '' + appendChild
        itemsList.replaceChildren(fragment);
        span.end();
        
        operationDurationHistogram.record(performance.now() - startTime, { 
            operation: 'renderItems' 
        });
    });
}

// OPTIMIZATION: Event Delegation for list items
function handleListClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') return;

    const action = target.dataset.action;
    const itemId = parseInt(target.dataset.id || '0', 10);

    if (action === 'edit') {
        const itemToEdit = localItemsCache.find(item => item.id === itemId);
        if (itemToEdit) startEdit(itemToEdit);
    } else if (action === 'delete') {
        deleteItem(itemId);
    }
}

function startEdit(item: Item): void {
    if (!itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn) return;
    isEditing = true;
    itemIdInput.value = item.id.toString();
    itemTitleInput.value = item.title;
    itemDescInput.value = item.description || '';
    submitBtn.textContent = 'Update Item';
    cancelBtn.hidden = false;

    logger.emit({
        severityNumber: SeverityNumber.DEBUG,
        severityText: 'DEBUG',
        body: 'UI switched to edit mode',
        attributes: { item_id: item.id }
    });
}

function resetForm(): void {
    if (!itemForm || !itemIdInput || !submitBtn || !cancelBtn) return;
    isEditing = false;
    itemIdInput.value = '';
    itemForm.reset();
    submitBtn.textContent = 'Create Item';
    cancelBtn.hidden = true;
}

// Global Event Listeners
itemForm.addEventListener('submit', saveItem);
cancelBtn.addEventListener('click', resetForm);
itemsList?.addEventListener('click', handleListClick);

// Initial items fetch invocation on script load
fetchItems();
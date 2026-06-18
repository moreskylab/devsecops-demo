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
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
// import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';

// Ensure Vite/TypeScript recognizes the environment variables types
// const COMPILED_URL = (import.meta as any).env?.VITE_API_URL || '';

// 1. Detect if the fallback placeholder string is literally active
// const isPlaceholderActive = !COMPILED_URL || COMPILED_URL.includes('__RUNTIME_');

// 2. Resolve the domain safely based on the placeholder state
// const BASE_DOMAIN = !isPlaceholderActive 
//     ? COMPILED_URL 
//     : (window.location.hostname === 'localhost' 
//         ? 'http://localhost:8080' // Your local backend dev server port
//         : window.location.origin); 

// const BASE_DOMAIN = 'http://localhost:8080'
// const API_URL = `${BASE_DOMAIN}/api`;
// const finalOtlpUrl = `${BASE_DOMAIN}/v1/traces`;
const API_URL = '/items';
const finalOtlpUrl = '/v1/traces';


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

// ==========================================
// APPLICATION LOGIC
// ==========================================

interface Item {
    id: number;
    title: string;
    description: string | null;
}

registerInstrumentations({
    instrumentations: [
        new FetchInstrumentation({
            propagateTraceHeaderCorsUrls: [ /.*/ ],
        }),
        new UserInteractionInstrumentation({
            eventNames: ['click', 'submit'],
        }),
    ],
});

const tracer = trace.getTracer('frontend-manual');

const itemForm = document.getElementById('item-form') as HTMLFormElement | null;
const itemIdInput = document.getElementById('item-id') as HTMLInputElement | null;
const itemTitleInput = document.getElementById('item-title') as HTMLInputElement | null;
const itemDescInput = document.getElementById('item-desc') as HTMLInputElement | null;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;
const itemsList = document.getElementById('items-list') as HTMLUListElement | null;

let isEditing = false;

if (!itemForm || !itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn || !itemsList) {
    throw new Error("Required DOM elements missing from the page.");
}

async function fetchItems(): Promise<void> {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const items: Item[] = await response.json();
        renderItems(items);
    } catch (err) {
        console.error("Failed fetching records:", err);
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

    if (!payload.title) return;

    const url = isEditing && id ? `${API_URL}/${id}` : API_URL;
    const method = isEditing && id ? 'PUT' : 'POST';

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
        } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            console.error("Failed saving payload:", err);
        } finally {
            span.end();
        }
    });
}

async function deleteItem(id: number): Promise<void> {
    if (!window.confirm("Delete this item?")) return;
    
    await tracer.startActiveSpan('ui.delete_item', async (span) => {
        try {
            span.setAttribute('item.id', id);
            const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            await fetchItems();
            span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            console.error("Failed dropping record:", err);
        } finally {
            span.end();
        }
    });
}

function renderItems(items: Item[]): void {
    if (!itemsList) return;
    
    tracer.startActiveSpan('ui.render_list', (span) => {
        span.setAttribute('items.count', items.length);
        itemsList.textContent = '';
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

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => startEdit(item));

            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.className = 'delete-btn';
            delBtn.addEventListener('click', () => deleteItem(item.id));

            actionsDiv.append(editBtn, delBtn);
            li.append(contentDiv, actionsDiv);
            fragment.appendChild(li);
        });

        itemsList.appendChild(fragment);
        span.end();
    });
}

function startEdit(item: Item): void {
    if (!itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn) return;
    isEditing = true;
    itemIdInput.value = item.id.toString();
    itemTitleInput.value = item.title;
    itemDescInput.value = item.description || '';
    submitBtn.textContent = 'Update Item';
    cancelBtn.hidden = false;
}

function resetForm(): void {
    if (!itemForm || !itemIdInput || !submitBtn || !cancelBtn) return;
    isEditing = false;
    itemIdInput.value = '';
    itemForm.reset();
    submitBtn.textContent = 'Create Item';
    cancelBtn.hidden = true;
}

// FIXED: Completed the broken syntax hooks safely 
itemForm.addEventListener('submit', saveItem);
cancelBtn.addEventListener('click', resetForm);

// Initial items fetch invocation on script load
fetchItems();

import './style.css';

// 1. Data Type Contract Definitions
interface Item {
    id: number;
    title: string;
    description: string | null;
}

// Cloud-Native Variable Extraction Loop
// Vite compiles a static value or leaves a string token. 
// If the static token exists and hasn't been substituted by NGINX, we pull the runtime value instead.
const COMPILED_URL = import.meta.env.VITE_API_URL;
const API_URL = (COMPILED_URL && !COMPILED_URL.includes('__RUNTIME_')) 
    ? COMPILED_URL 
    : '__RUNTIME_VITE_API_URL__';

// 2. DOM Elements Selection (Checking for null prevents runtime crashes)
const itemForm = document.getElementById('item-form') as HTMLFormElement | null;
const itemIdInput = document.getElementById('item-id') as HTMLInputElement | null;
const itemTitleInput = document.getElementById('item-title') as HTMLInputElement | null;
const itemDescInput = document.getElementById('item-desc') as HTMLInputElement | null;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;
const itemsList = document.getElementById('items-list') as HTMLUListElement | null;

let isEditing = false;

// Helper to assert elements exist safely
if (!itemForm || !itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn || !itemsList) {
    throw new Error("Required DOM elements missing from the page.");
}

// 3. API Actions
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

    if (!payload.title) return; // Prevent empty title submission

    const url = isEditing && id ? `${API_URL}/${id}` : API_URL;
    const method = isEditing && id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        resetForm();
        await fetchItems();
    } catch (err) {
        console.error("Failed saving payload:", err);
    }
}

async function deleteItem(id: number): Promise<void> {
    // Avoid blocking window.confirm(); ideally transition this to a custom modal or <dialog>
    if (!window.confirm("Delete this item?")) return;
    
    try {
        const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        await fetchItems();
    } catch (err) {
        console.error("Failed dropping record:", err);
    }
}

// 4. UI Rendering Engine (Optimised & Secure)
function renderItems(items: Item[]): void {
    if (!itemsList) return;
    
    // Clear list safely
    itemsList.textContent = '';
    
    // Use a DocumentFragment to minimize browser layout repaints
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const li = document.createElement('li');
        
        const contentDiv = document.createElement('div');
        // Securely assign textual content using textContent to prevent XSS vulnerability injections
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
}

function startEdit(item: Item): void {
    if (!itemIdInput || !itemTitleInput || !itemDescInput || !submitBtn || !cancelBtn) return;
    
    isEditing = true;
    itemIdInput.value = item.id.toString();
    itemTitleInput.value = item.title;
    itemDescInput.value = item.description || '';
    submitBtn.textContent = 'Update Item';
    cancelBtn.hidden = false; // Prefers the modern semantic HTML 'hidden' property over inline styles
}

function resetForm(): void {
    if (!itemForm || !itemIdInput || !submitBtn || !cancelBtn) return;
    
    isEditing = false;
    itemForm.reset();
    itemIdInput.value = '';
    submitBtn.textContent = 'Add Item';
    cancelBtn.hidden = true;
}

// 5. Event Binding Listeners
itemForm.addEventListener('submit', saveItem);
cancelBtn.addEventListener('click', resetForm);

// If the script runs inside a standard module type script (`<script type="module">`),
// DOMContentLoaded is often redundant since modules defer execution automatically.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchItems);
} else {
    fetchItems();
}

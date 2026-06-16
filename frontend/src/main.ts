import './style.css';

// 1. Data Type Contract Definitions
interface Item {
    id: number;
    title: string;
    description: string | null;
}

const API_URL = import.meta.env.API_URL || 'http://localhost:8000/items';

// 2. DOM Elements Selection
const itemForm = document.getElementById('item-form') as HTMLFormElement;
const itemIdInput = document.getElementById('item-id') as HTMLInputElement;
const itemTitleInput = document.getElementById('item-title') as HTMLInputElement;
const itemDescInput = document.getElementById('item-desc') as HTMLInputElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const itemsList = document.getElementById('items-list') as HTMLUListElement;

let isEditing = false;

// 3. API Actions
async function fetchItems(): Promise<void> {
    try {
        const response = await fetch(API_URL);
        const items: Item[] = await response.json();
        renderItems(items);
    } catch (err) {
        console.error("Failed fetching records:", err);
    }
}

async function saveItem(e: Event): Promise<void> {
    e.preventDefault();
    
    const id = itemIdInput.value;
    const payload = {
        title: itemTitleInput.value,
        description: itemDescInput.value || null
    };

    try {
        if (isEditing && id) {
            // Update operation
            await fetch(`${API_URL}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            // Create operation
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        resetForm();
        await fetchItems();
    } catch (err) {
        console.error("Failed saving payload:", err);
    }
}

async function deleteItem(id: number): Promise<void> {
    if (!confirm("Delete this item?")) return;
    try {
        await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        await fetchItems();
    } catch (err) {
        console.error("Failed dropping record:", err);
    }
}

// 4. UI Rendering Engine
function renderItems(items: Item[]): void {
    itemsList.innerHTML = '';
    items.forEach(item => {
        const li = document.createElement('li');
        
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = `<strong>${item.title}</strong> ${item.description ? `- ${item.description}` : ''}`;
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(item));

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'delete-btn';
        delBtn.addEventListener('click', () => deleteItem(item.id));

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);
        
        li.appendChild(contentDiv);
        li.appendChild(actionsDiv);
        itemsList.appendChild(li);
    });
}

function startEdit(item: Item): void {
    isEditing = true;
    itemIdInput.value = item.id.toString();
    itemTitleInput.value = item.title;
    itemDescInput.value = item.description || '';
    submitBtn.textContent = 'Update Item';
    cancelBtn.style.display = 'inline-block';
}

function resetForm(): void {
    isEditing = false;
    itemForm.reset();
    itemIdInput.value = '';
    submitBtn.textContent = 'Add Item';
    cancelBtn.style.display = 'none';
}

// 5. Event Binding Listeners
itemForm.addEventListener('submit', saveItem);
cancelBtn.addEventListener('click', resetForm);

// Initial Load Hook
document.addEventListener('DOMContentLoaded', fetchItems);

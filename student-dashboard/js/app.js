// Global variables
let currentUser = null;
let assignments = [];
let filtered = [];

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Called by Google Identity Services after sign-in
function handleCredentialResponse(response) {
    // Decode the JWT credential
    const responsePayload = decodeJwtResponse(response.credential);
    const email = responsePayload.email;
    
    // Check if email is allowed
    if (CONFIG.ALLOWED_EMAILS.includes(email)) {
        currentUser = email;
        localStorage.setItem('user_email', email);
        showApp();
        loadAssignments();
    } else {
        alert('Sorry, your email is not authorized to access this dashboard.');
    }
}

// Decode JWT token from Google
function decodeJwtResponse(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// Sign out function
function signOut() {
    google.accounts.id.disableAutoSelect();
    localStorage.removeItem('user_email');
    currentUser = null;
    location.reload();
}

// Show/hide UI elements
function showApp() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app').style.display = 'block';
}

function showLogin() {
    document.getElementById('login-container').style.display = 'block';
    document.getElementById('app').style.display = 'none';
}

// ============================================================================
// API COMMUNICATION
// ============================================================================

async function apiCall(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.append('key', CONFIG.API_KEY);
    url.searchParams.append('action', action);
    
    // Add any additional parameters
    Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]);
    });
    
    try {
        const response = await fetch(url.toString());
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'API request failed');
        }
        
        return data.data;
    } catch (error) {
        console.error('API Error:', error);
        showFeedback('❌ Error: ' + error.message);
        throw error;
    }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadAssignments() {
    try {
        showLoading('Loading your assignments...');
        
        // Fetch assignments
        assignments = await apiCall('getAssignments');
        
        // Fetch categories for filter
        const categories = await apiCall('getCategories');
        populateSubjectFilter(categories);
        
        // Initial render
        filtered = assignments.slice();
        render();
        
    } catch (error) {
        document.getElementById('assignmentsList').innerHTML = 
            '<div class="error">Failed to load assignments. Please refresh the page.</div>';
    }
}

function populateSubjectFilter(categories) {
    const select = document.getElementById('subjectFilter');
    select.innerHTML = '<option value="all">All Subjects</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

// ============================================================================
// FILTERING
// ============================================================================

function applyFilters() {
    const subject = document.getElementById('subjectFilter').value;
    const type = document.getElementById('typeFilter').value;
    const status = document.getElementById('statusFilter').value;
    
    filtered = assignments.filter(a => {
        if (subject !== 'all' && a.category !== subject) return false;
        if (type !== 'all' && a.type !== type) return false;
        if (status !== 'all' && a.status !== status) return false;
        return true;
    });
    
    render();
}

function showTodayOnly() {
    filtered = assignments.filter(a => a.daysUntilDue === 0);
    render();
}

function showThisWeek() {
    filtered = assignments.filter(a => a.daysUntilDue >= 0 && a.daysUntilDue <= 7);
    render();
}

function showTests() {
    filtered = assignments.filter(a => a.type === 'Test/Quiz');
    render();
}

// ============================================================================
// RENDERING
// ============================================================================

function render() {
    const container = document.getElementById('assignmentsList');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-assignments">No assignments found!</div>';
        updateProgress();
        return;
    }
    
    // Sort by due date
    filtered.sort((a, b) => {
        const aDays = typeof a.daysUntilDue === 'number' ? a.daysUntilDue : 9999;
        const bDays = typeof b.daysUntilDue === 'number' ? b.daysUntilDue : 9999;
        return aDays - bDays;
    });
    
    container.innerHTML = filtered.map(renderAssignmentCard).join('');
    updateProgress();
}

function renderAssignmentCard(assignment) {
    const typeClass = getTypeClass(assignment.type);
    const completed = assignment.status === 'Completed';
    
    return `
        <div class="assignment-card ${typeClass} ${completed ? 'completed' : ''}">
            <div class="assignment-header">
                <input type="checkbox" 
                       class="checkbox-complete"
                       ${completed ? 'checked' : ''} 
                       onchange="updateStatus('${assignment.uid}', this.checked)">
                <div class="assignment-title">${escapeHtml(assignment.title)}</div>
                <span class="type-badge ${typeClass}">${assignment.type || 'Assignment'}</span>
            </div>
            <div class="assignment-details">
                <span class="detail-item">📚 ${escapeHtml(assignment.category)}</span>
                <span class="detail-item">📅 ${formatDueDate(assignment)}</span>
                <span class="detail-item">⚡ ${assignment.priority}</span>
            </div>
            ${assignment.description ? 
                `<div class="assignment-description">${escapeHtml(assignment.description)}</div>` : ''}
        </div>
    `;
}

// ============================================================================
// STATUS UPDATES
// ============================================================================

async function updateStatus(uid, isChecked) {
    const newStatus = isChecked ? 'Completed' : 'Not Started';
    
    try {
        await apiCall('updateStatus', { uid: uid, status: newStatus });
        
        // Update local data
        const assignment = assignments.find(a => a.uid === uid);
        if (assignment) {
            assignment.status = newStatus;
        }
        
        showFeedback(isChecked ? '✅ Marked as complete!' : '📌 Marked as incomplete');
        render();
        
    } catch (error) {
        // Revert checkbox on error
        const checkbox = document.querySelector(`input[onchange="updateStatus('${uid}', this.checked)"]`);
        if (checkbox) checkbox.checked = !isChecked;
    }
}

async function syncData() {
    try {
        showLoading('Syncing with calendar...');
        await apiCall('sync');
        showFeedback('✅ Sync complete!');
        await loadAssignments();
    } catch (error) {
        showFeedback('❌ Sync failed');
    }
}

// ============================================================================
// UI HELPERS
// ============================================================================

function updateProgress() {
    const total = assignments.length;
    const completed = assignments.filter(a => a.status === 'Completed').length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const bar = document.getElementById('progressBar');
    if (bar) {
        bar.style.width = percentage + '%';
        bar.textContent = `${percentage}% Complete`;
    }
}

function getTypeClass(type) {
    const typeMap = {
        'Test/Quiz': 'test-quiz',
        'Project': 'project',
        'Homework': 'homework',
        'Reading': 'reading',
        'Classwork': 'classwork',
        'Participation': 'participation'
    };
    return typeMap[type] || 'assignment';
}

function formatDueDate(assignment) {
    const days = assignment.daysUntilDue;
    if (typeof days !== 'number') return assignment.dueDate || 'No due date';
    if (days < 0) return `⚠️ Overdue by ${Math.abs(days)} days`;
    if (days === 0) return '🔴 Due Today';
    if (days === 1) return '🟡 Due Tomorrow';
    if (days <= 3) return `🟡 Due in ${days} days`;
    return `Due in ${days} days`;
}

function showLoading(message) {
    const container = document.getElementById('assignmentsList');
    if (container) {
        container.innerHTML = `<div class="loading">${message}</div>`;
    }
}

function showFeedback(message) {
    const div = document.createElement('div');
    div.className = 'feedback-message';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', function() {
    // Check if user was previously signed in
    const savedEmail = localStorage.getItem('user_email');
    if (savedEmail && CONFIG.ALLOWED_EMAILS.includes(savedEmail)) {
        currentUser = savedEmail;
        showApp();
        loadAssignments();
    } else {
        showLogin();
    }
});

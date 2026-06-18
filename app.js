// Mock Data Store (until Supabase is connected)
const store = {
    medications: [
        { id: 1, name: "Aspirin", dose: "81mg", notes: "Take with food" },
        { id: 2, name: "Lisinopril", dose: "10mg", notes: "Take in the morning" }
    ],
    // Generating mock doses for today
    doses: []
};

// Generate initial mock doses based on current time
function initMockData() {
    const now = new Date();
    
    // A dose that is due soon (pending)
    const dueSoon = new Date(now);
    dueSoon.setMinutes(now.getMinutes() - 10); // Due 10 mins ago

    // A dose that was taken
    const taken = new Date(now);
    taken.setHours(8, 0, 0); // 8 AM

    // A dose that was missed
    const missed = new Date(now);
    missed.setHours(9, 0, 0); // 9 AM
    missed.setDate(now.getDate() - 1); // Yesterday to guarantee missed

    store.doses = [
        { id: 1, medication_id: 1, scheduled_for: dueSoon.toISOString(), status: 'pending', taken_at: null },
        { id: 2, medication_id: 2, scheduled_for: taken.toISOString(), status: 'taken', taken_at: new Date(taken.getTime() + 5*60000).toISOString() },
    ];
}

// App Logic
const app = {
    init() {
        initMockData();
        this.container = document.getElementById('view-container');
        this.navigate('home');
        
        // Global click handler for routing
        document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-route]');
            if (btn) {
                this.navigate(btn.dataset.route);
            }
        });
    },

    navigate(route) {
        this.currentRoute = route;
        const template = document.getElementById(`tpl-${route}`);
        if (!template) return;
        
        this.container.innerHTML = '';
        this.container.appendChild(template.content.cloneNode(true));

        // Call route specific initializer
        if (this[`init_${route}`]) {
            this[`init_${route}`]();
        }
    },

    init_home() {
        // Calculate taken vs missed for TODAY
        const today = new Date().toISOString().split('T')[0];
        let takenCount = 0;
        let missedCount = 0;

        store.doses.forEach(dose => {
            if (dose.scheduled_for.startsWith(today)) {
                if (dose.status === 'taken') takenCount++;
                if (dose.status === 'missed') missedCount++;
            }
        });

        document.getElementById('stat-taken').textContent = takenCount;
        document.getElementById('stat-missed').textContent = missedCount;
    },

    init_medications() {
        const listEl = document.getElementById('med-list');
        listEl.innerHTML = '';

        // Sort doses by scheduled time
        const sortedDoses = [...store.doses].sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));

        sortedDoses.forEach(dose => {
            const med = store.medications.find(m => m.id === dose.medication_id);
            const timeStr = new Date(dose.scheduled_for).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const item = document.createElement('div');
            item.className = 'list-item';
            
            let actionHtml = '';
            if (dose.status === 'pending') {
                actionHtml = `<button class="action-btn" onclick="app.markDoseTaken(${dose.id})">Done</button>`;
            } else if (dose.status === 'taken') {
                actionHtml = `<div class="status-badge status-taken">Taken at ${new Date(dose.taken_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>`;
            } else {
                actionHtml = `<div class="status-badge status-missed">Missed</div>`;
            }

            item.innerHTML = `
                <h3>${med.name} (${med.dose})</h3>
                <p>Due: <strong>${timeStr}</strong></p>
                ${med.notes ? `<p><em>${med.notes}</em></p>` : ''}
                ${actionHtml}
            `;
            listEl.appendChild(item);
        });
    },

    markDoseTaken(doseId) {
        const dose = store.doses.find(d => d.id === doseId);
        if (dose) {
            dose.status = 'taken';
            dose.taken_at = new Date().toISOString();
            // Re-render
            this.init_medications();
        }
    }
};

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => app.init());

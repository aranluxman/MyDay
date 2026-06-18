// Mock Data Store (until Supabase is connected)
const store = {
    medications: [
        { id: 1, name: "Aspirin", dose: "81mg", notes: "Take with food" },
        { id: 2, name: "Lisinopril", dose: "10mg", notes: "Take in the morning" }
    ],
    appointments: [
        { id: 1, date: "Tomorrow", time: "10:00 AM", doctor_name: "Dr. Smith", location: "City Clinic", reason: "Checkup" },
        { id: 2, date: "Next Tuesday", time: "2:00 PM", doctor_name: "Dr. Jones", location: "Eye Center", reason: "Vision Test" }
    ],
    game_results: [],
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
    },

    init_appointments() {
        const listEl = document.getElementById('appts-list');
        listEl.innerHTML = '';

        if (store.appointments.length === 0) {
            listEl.innerHTML = '<p style="text-align:center;">No upcoming appointments.</p>';
            return;
        }

        store.appointments.forEach(appt => {
            const item = document.createElement('div');
            item.className = 'list-item';
            
            item.innerHTML = `
                <h3>${appt.doctor_name}</h3>
                <p><strong>${appt.date} at ${appt.time}</strong></p>
                <p>Location: ${appt.location}</p>
                <p>Reason: ${appt.reason}</p>
            `;
            listEl.appendChild(item);
        });
    },

    init_games() {
        // Nothing special needed for the menu yet
    },

    init_gameOrientation() {
        const questions = [
            { q: "What day of the week is it?", a: new Date().toLocaleDateString('en-US', {weekday: 'long'}), options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
            // Could add month, season etc.
        ];
        
        // Simple random question (just one for now)
        const qData = questions[0];
        
        document.getElementById('orientation-question').textContent = qData.q;
        const answersContainer = document.getElementById('orientation-answers');
        answersContainer.innerHTML = '';
        
        // Render buttons
        qData.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'nav-btn';
            btn.textContent = opt;
            btn.onclick = () => {
                const feedback = document.getElementById('orientation-feedback');
                if (opt === qData.a) {
                    feedback.textContent = "Great job! That's correct.";
                    feedback.className = "feedback-msg good";
                    btn.classList.add('action-btn'); // Turn green
                } else {
                    feedback.textContent = "Not quite, try again!";
                    feedback.className = "feedback-msg bad";
                }
            };
            answersContainer.appendChild(btn);
        });
    }
};

// Handle route formatting for dynamic calls
app.navigate = function(route) {
    this.currentRoute = route;
    const template = document.getElementById(`tpl-${route}`);
    if (!template) return;
    
    this.container.innerHTML = '';
    this.container.appendChild(template.content.cloneNode(true));

    // Convert route-name to routeName
    const funcName = 'init_' + route.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    
    // Call route specific initializer
    if (this[funcName]) {
        this[funcName]();
    }
};

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => app.init());

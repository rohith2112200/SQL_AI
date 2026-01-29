/* -----------------------------------------------------------------------------
   SQL AI - LOGIN LOGIC & ANIMATION SYSTEM
   Feature: "Neural Data Mesh" (Canvas Animation)
----------------------------------------------------------------------------- */
const apiBase = '/api/auth';

document.addEventListener('DOMContentLoaded', () => {
    console.log("SQL.ai Login Loaded");

    // =============================================================================
    // 0. CUSTOM SELECT LOGIC
    // =============================================================================
    const setupCustomSelect = () => {
        const container = document.getElementById('customSelect');
        if (!container) return;

        const trigger = container.querySelector('.custom-select-trigger');
        const options = container.querySelectorAll('.custom-option');
        const hiddenInput = document.getElementById('regQuestion');
        const textSpan = document.getElementById('selectText');

        // Toggle
        trigger.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent window click
            container.classList.toggle('open');
        });

        // Select Option
        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = opt.getAttribute('data-value');
                const label = opt.textContent;

                // Update UI
                textSpan.textContent = label;
                textSpan.style.color = 'var(--text-main)'; // ensure visible color
                hiddenInput.value = val;

                // Close
                container.classList.remove('open');
            });
        });

        // Close on Click Outside
        window.addEventListener('click', () => {
            container.classList.remove('open');
        });
    };
    setupCustomSelect();

    // =============================================================================
    // 0. GLOBAL TOGGLE
    // =============================================================================
    window.toggleAuth = function (mode) {
        console.log("Toggling Auth Mode:", mode);
        const loginForm = document.getElementById('loginForm');
        const regForm = document.getElementById('registerForm');
        const forgotForm = document.getElementById('forgotForm');

        const fadeOut = (el) => {
            if (!el) return;
            el.style.opacity = '0';
            setTimeout(() => el.style.display = 'none', 300);
        };

        const fadeIn = (el) => {
            if (!el) return;
            el.style.display = 'block';
            el.style.animation = 'none';
            el.offsetHeight; /* trigger reflow */
            el.style.animation = null;
            setTimeout(() => el.style.opacity = '1', 50);
        };

        if (mode === 'login') {
            fadeOut(regForm); fadeOut(forgotForm);
            setTimeout(() => fadeIn(loginForm), 300);
        } else if (mode === 'register') {
            fadeOut(loginForm); fadeOut(forgotForm);
            setTimeout(() => fadeIn(regForm), 300);
        } else if (mode === 'forgot') {
            fadeOut(loginForm); fadeOut(regForm);
            setTimeout(() => {
                fadeIn(forgotForm);
                // Reset to Step 1
                document.getElementById('forgotStep1').style.display = 'block';
                document.getElementById('forgotStep2').style.display = 'none';
                document.getElementById('forgotStep3').style.display = 'none';
                if (document.getElementById('resetUser')) document.getElementById('resetUser').value = '';
                if (document.getElementById('resetAnswer')) document.getElementById('resetAnswer').value = '';
                if (document.getElementById('resetPass')) document.getElementById('resetPass').value = '';
            }, 300);
        }
    };

    // =============================================================================
    // 1. NEURAL MESH
    // =============================================================================
    const canvas = document.getElementById('neuralMesh');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let particles = [];
        const config = { particleCount: 120, connectionDistance: 180, mouseDistance: 300, baseSpeed: 0.8, color: '#22d3ee', lineColor: 'rgba(52, 211, 153, 0.25)' };

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        let mouse = { x: null, y: null };
        window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
        window.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });

        class Particle {
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.vx = (Math.random() - 0.5) * config.baseSpeed;
                this.vy = (Math.random() - 0.5) * config.baseSpeed;
                this.size = Math.random() * 2.5 + 0.5;
                const colors = ['#22d3ee', '#34d399', '#ffffff'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
            }
            update() {
                this.x += this.vx; this.y += this.vy;
                if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
                if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
                if (mouse.x != null) {
                    let dx = mouse.x - this.x, dy = mouse.y - this.y;
                    let distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < config.mouseDistance) {
                        const forceDirectionX = dx / distance, forceDirectionY = dy / distance;
                        const force = (config.mouseDistance - distance) / config.mouseDistance;
                        this.vx += forceDirectionX * force * 0.08; this.vy += forceDirectionY * force * 0.08;
                    }
                }
            }
            draw() {
                ctx.fillStyle = this.color; ctx.shadowBlur = 15; ctx.shadowColor = this.color;
                ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
            }
        }
        function initParticles() {
            particles = [];
            for (let i = 0; i < config.particleCount; i++) { particles.push(new Particle()); }
        }
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < particles.length; i++) {
                for (let j = i; j < particles.length; j++) {
                    let dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
                    let distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < config.connectionDistance) {
                        ctx.beginPath(); ctx.strokeStyle = config.lineColor; ctx.lineWidth = 1;
                        ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.stroke();
                    }
                }
            }
            particles.forEach(p => { p.update(); p.draw(); });
            requestAnimationFrame(animate);
        }
        initParticles(); animate();
    }

    // =============================================================================
    // 2. AUTH LOGIC
    // =============================================================================
    async function handleAuth(url, data, msgEl) {
        if (msgEl) { msgEl.style.display = 'none'; msgEl.className = 'message-box'; }
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await res.json();
            if (res.ok) {
                if (msgEl) { msgEl.textContent = result.message || 'Success!'; msgEl.classList.add('success'); msgEl.style.display = 'block'; }
                return { success: true };
            } else {
                if (msgEl) { msgEl.textContent = result.error || 'Failed'; msgEl.classList.add('error'); msgEl.style.display = 'block'; }
                else { alert(result.error || 'Operation Failed'); }
                return { success: false };
            }
        } catch (err) {
            console.error(err);
            if (msgEl) { msgEl.textContent = 'Network Error'; msgEl.classList.add('error'); msgEl.style.display = 'block'; }
            else { alert('Network Error. Please Check Server.'); }
            return { success: false };
        }
    }

    // Login
    const loginF = document.getElementById('loginForm');
    if (loginF) {
        loginF.addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('loginUser').value;
            const p = document.getElementById('loginPass').value;
            const b = document.getElementById('magneticBtn');
            if (b) { b.classList.add('loading'); b.disabled = true; }
            await new Promise(r => setTimeout(r, 600));
            const res = await handleAuth(`${apiBase}/login`, { username: u, password: p }, document.getElementById('loginMsg'));
            if (b) { b.classList.remove('loading'); b.disabled = false; }
            if (res.success) {
                // START EXIT ANIMATION
                document.body.classList.add('exit-mode');

                // Wait for animation (800ms) then redirect
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 800);
            } else {
                const card = document.querySelector('.glass-login-card');
                if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
            }
        });
    }

    // Register
    const regF = document.getElementById('registerForm');
    if (regF) {
        regF.addEventListener('submit', async (e) => {
            e.preventDefault();
            const q = document.getElementById('regQuestion').value;
            const a = document.getElementById('regAnswer').value;
            if (!q || !a) { alert("Please complete the Security Question."); return; }
            const b = regF.querySelector('button[type="submit"]');
            if (b) { b.classList.add('loading'); b.disabled = true; }
            const res = await handleAuth(`${apiBase}/register`, {
                fullName: document.getElementById('regName').value,
                username: document.getElementById('regUser').value, email: document.getElementById('regEmail').value,
                password: document.getElementById('regPass').value, securityQuestion: q, securityAnswer: a
            }, null);
            if (b) { b.classList.remove('loading'); b.disabled = false; }
            if (res.success) { alert("Account Created Successfully!"); window.toggleAuth('login'); }
        });
    }

    // Forgot Password Logic
    window.fetchSecurityQuestion = async function () {
        const username = document.getElementById('resetUser').value;
        if (!username) { alert('Please enter your username first.'); return; }
        const display = document.getElementById('securityQuestionDisplay');
        if (display) display.textContent = "Checking user...";

        try {
            const res = await fetch(`${apiBase}/security-question/${username}`);
            // Check for HTML response (Server not updated)
            const type = res.headers.get("content-type");
            if (type && type.includes('text/html')) {
                throw new Error("Server Update Required. Please Restart Node Server.");
            }

            const data = await res.json();
            if (res.ok) {
                const map = { 'pet': 'What was the name of your first pet?', 'school': 'What elementary school did you attend?', 'city': 'In what city were you born?' };
                if (display) display.textContent = map[data.question] || data.question;

                // Show Step 2, Hide Step 3
                document.getElementById('forgotStep1').style.display = 'none';
                document.getElementById('forgotStep2').style.display = 'block';
                document.getElementById('forgotStep3').style.display = 'none';
            } else {
                alert(data.error || 'User not found');
            }
        } catch (e) {
            alert(e.message || 'Connection Error');
        }
    };

    // STEP 2: VERIFY ANSWER
    window.verifySecurityAnswer = async function () {
        const username = document.getElementById('resetUser').value;
        const answer = document.getElementById('resetAnswer').value;
        if (!answer) { alert("Please enter an answer"); return; }

        const btn = document.querySelector('#forgotStep2 button');
        const oldText = btn.textContent;
        btn.textContent = "Verifying..."; btn.disabled = true;

        try {
            const res = await fetch(`${apiBase}/verify-answer`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, answer })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                // Success - Show Step 3
                document.getElementById('forgotStep2').style.display = 'none';
                document.getElementById('forgotStep3').style.display = 'block';
            } else {
                alert(data.error || "Incorrect Answer");
            }
        } catch (e) {
            alert("Verification Failed. " + e.message);
        } finally {
            btn.textContent = oldText; btn.disabled = false;
        }
    };

    // STEP 3: SUBMIT RESET
    const forgotF = document.getElementById('forgotForm');
    if (forgotF) {
        forgotF.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('resetUser').value;
            const answer = document.getElementById('resetAnswer').value;
            const newPass = document.getElementById('resetPass').value;
            const b = forgotF.querySelector('button[type="submit"]');
            if (b) { b.classList.add('loading'); b.disabled = true; }

            const res = await handleAuth(`${apiBase}/reset-password`, {
                username, answer, newPassword: newPass
            }, null);

            if (b) { b.classList.remove('loading'); b.disabled = false; }
            if (res.success) {
                alert('Password Reset Successful! Please Login.');
                window.toggleAuth('login');
            }
        });
    }
});

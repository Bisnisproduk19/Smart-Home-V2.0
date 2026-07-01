// ============================================
// KONFIGURASI MQTT
// ============================================

const mqttConfig = {
    host: "wss://084db5b7c92941f3873458276a95ca57.s1.eu.hivemq.cloud:8884/mqtt",
    username: "Smart_Home",
    password: "SmartHome1231*"
};

const client = mqtt.connect(mqttConfig.host, {
    username: mqttConfig.username,
    password: mqttConfig.password,
    reconnectPeriod: 2000,
    clean: true,
    protocolId: 'MQTT',
    protocolVersion: 4
});

// ============================================
// STATE - AUTO DARI ESP32
// ============================================

let TOTAL_RELAY = 0;
let NAMA_RELAY = [];
let PIN_GPIO = {};
let relayLampu = [];
let relayPerangkat = [];
let configReceived = false;
let relayStates = {};
let espOnline = false;
let lastHeartbeat = 0;
let everOnline = false;
let pendingCommands = {};
const commandTimeout = 5000;

// ============================================
// FUNGSI UTILITY
// ============================================

function getElement(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`⚠️ Element not found: ${id}`);
    return el;
}

function showToast(message, type = 'info', duration = 3000) {
    const oldToast = document.querySelector('.toast-notification');
    if (oldToast) oldToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    const colors = { success: '#00b894', error: '#e74c3c', warning: '#f39c12', info: '#3498db', loading: '#f39c12' };
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️', loading: '⏳' };
    
    toast.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        color: #fff;
        font-weight: 500;
        z-index: 9999;
        animation: slideIn 0.3s ease;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        background: ${colors[type] || '#333'};
        max-width: 400px;
        font-family: 'Segoe UI', sans-serif;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.9rem;
    `;
    
    toast.innerHTML = `<span style="font-size: 1.2rem;">${icons[type] || 'ℹ️'}</span> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getRelayName(relayId) {
    const index = relayId - 1;
    if (index >= 0 && index < NAMA_RELAY.length) return NAMA_RELAY[index];
    return `Relay ${relayId}`;
}

function getPinInfo(relayId) {
    return PIN_GPIO[relayId] || '-';
}

// ============================================
// UPDATE STATUS
// ============================================

function updateMQTTStatus(isConnected) {
    const badge = getElement('mqttStatusBadge');
    const dot = getElement('mqttDot');
    const text = getElement('mqttStatusText');
    
    if (isConnected) {
        if (badge) { badge.className = 'status-badge online'; badge.textContent = '● Online'; }
        if (dot) { dot.className = 'status-dot online'; }
        if (text) { text.className = 'status-text online'; text.textContent = 'MQTT: Online'; }
    } else {
        if (badge) { badge.className = 'status-badge offline'; badge.textContent = '● Offline'; }
        if (dot) { dot.className = 'status-dot offline'; }
        if (text) { text.className = 'status-text offline'; text.textContent = 'MQTT: Offline'; }
    }
}

function updateESPStatus(isOnline) {
    espOnline = isOnline;
    
    const badge = getElement('espStatusBadge');
    const dot = getElement('espDot');
    const text = getElement('espStatusText');
    
    if (isOnline) {
        if (badge) { badge.className = 'status-badge online'; badge.textContent = '● Online'; }
        if (dot) { dot.className = 'status-dot online'; }
        if (text) { text.className = 'status-text online'; text.textContent = 'ESP32: Online'; }
    } else {
        if (badge) { badge.className = 'status-badge offline'; badge.textContent = '● Offline'; }
        if (dot) { dot.className = 'status-dot offline'; }
        if (text) { text.className = 'status-text offline'; text.textContent = 'ESP32: Offline'; }
    }
}

// ============================================
// ✅ PROSES KONFIGURASI DARI ESP32
// ============================================

function processConfig(data) {
    try {
        const config = JSON.parse(data);
        
        if (config.type !== 'relay_config') return;
        
        TOTAL_RELAY = config.count || 0;
        const pins = config.pins || [];
        const names = config.names || [];
        
        console.log('📌 [CONFIG] Received from ESP32:');
        console.log(`   Total Relay: ${TOTAL_RELAY}`);
        console.log(`   Pins: ${pins.join(', ')}`);
        
        PIN_GPIO = {};
        for (let i = 0; i < pins.length; i++) {
            PIN_GPIO[i + 1] = pins[i];
        }
        
        NAMA_RELAY = [];
        for (let i = 0; i < names.length; i++) {
            NAMA_RELAY.push(names[i] || `Relay ${i + 1}`);
        }
        
        while (NAMA_RELAY.length < TOTAL_RELAY) {
            NAMA_RELAY.push(`Relay ${NAMA_RELAY.length + 1}`);
        }
        
        relayLampu = NAMA_RELAY.slice(0, Math.min(12, TOTAL_RELAY));
        relayPerangkat = NAMA_RELAY.slice(12, TOTAL_RELAY);
        
        configReceived = true;
        
        // Inisialisasi state
        for (let i = 1; i <= TOTAL_RELAY; i++) {
            if (!relayStates[i]) relayStates[i] = false;
        }
        
        renderAll();
        console.log('✅ [APP] Config applied, UI re-rendered');
        showToast(`✅ Konfigurasi ESP32: ${TOTAL_RELAY} relay`, 'success');
        
    } catch (e) {
        console.error('❌ [CONFIG] Gagal parse:', e);
    }
}

// ============================================
// ✅ FUNGSI KONTROL RELAY
// ============================================

function sendRelayCommand(relayId, command) {
    console.log(`📤 [CMD] Relay ${relayId} -> ${command}`);
    
    if (!client || !client.connected) {
        showToast('❌ MQTT tidak terhubung!', 'error');
        return;
    }
    
    if (!espOnline) {
        showToast('⚠️ ESP32 offline! Periksa koneksi.', 'warning');
        return;
    }
    
    if (relayId < 1 || relayId > TOTAL_RELAY) {
        showToast(`❌ Relay ${relayId} tidak valid!`, 'error');
        return;
    }
    
    const previousState = relayStates[relayId] || false;
    const newState = command === 'ON';
    
    pendingCommands[relayId] = {
        command: command,
        previousState: previousState,
        timestamp: Date.now(),
        status: 'pending'
    };
    
    // ✅ UPDATE UI
    relayStates[relayId] = newState;
    updateRelayUI(relayId, newState);
    
    showToast(`⏳ ${command} ${getRelayName(relayId)}...`, 'loading', 2000);
    
    // ✅ PUBLISH KE MQTT
    const topic = `home/relay/${relayId}/control`;
    client.publish(topic, command);
    console.log(`📤 [MQTT] Published: ${topic} -> ${command}`);
    
    // TIMEOUT - ROLLBACK
    setTimeout(() => {
        if (pendingCommands[relayId] && pendingCommands[relayId].status === 'pending') {
            const rollbackState = pendingCommands[relayId].previousState;
            relayStates[relayId] = rollbackState;
            updateRelayUI(relayId, rollbackState);
            showToast(`⚠️ ${getRelayName(relayId)} tidak merespon!`, 'warning', 4000);
            delete pendingCommands[relayId];
        }
    }, commandTimeout);
}

window.toggleRelay = function(relayId) {
    console.log(`🔘 [CLICK] Relay ${relayId} ditekan!`);
    const currentState = relayStates[relayId] || false;
    const command = currentState ? 'OFF' : 'ON';
    sendRelayCommand(relayId, command);
};

// ============================================
// UPDATE UI
// ============================================

function updateRelayUI(relayId, isOn) {
    const card = getElement(`relay-${relayId}`);
    if (!card) return;
    
    const statusSpan = card.querySelector('.relay-status span');
    const btn = card.querySelector('.btn-relay');
    const dot = card.querySelector('.status-dot-small');
    
    if (statusSpan) {
        statusSpan.textContent = isOn ? 'NYALA' : 'MATI';
        statusSpan.className = isOn ? 'on' : 'off';
    }
    if (btn) {
        btn.textContent = isOn ? 'MATIKAN' : 'NYALAKAN';
        btn.className = `btn-relay ${isOn ? 'on' : 'off'}`;
        btn.disabled = false;
    }
    if (dot) {
        dot.className = `status-dot-small ${isOn ? 'on' : 'off'}`;
    }
    card.className = `relay-card ${isOn ? 'on' : 'off'}`;
}

// ============================================
// RENDER UI
// ============================================

function renderAll() {
    if (!configReceived || TOTAL_RELAY === 0) {
        renderWaitingState();
        return;
    }
    
    console.log('🎨 Rendering UI dengan config dari ESP32');
    
    if (relayLampu.length > 0) {
        renderRelayGrid('lampuManual', relayLampu, 1);
        renderRelayGrid('lampuAuto', relayLampu, 1);
    }
    if (relayPerangkat.length > 0) {
        renderRelayGrid('perangkatManual', relayPerangkat, 13);
        renderRelayGrid('perangkatAuto', relayPerangkat, 13);
    }
    renderSensorGrid();
}

function renderWaitingState() {
    const containers = ['lampuManual', 'lampuAuto', 'perangkatManual', 'perangkatAuto'];
    containers.forEach(id => {
        const container = getElement(id);
        if (container) {
            container.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#6c757d;">
                    <i class="fas fa-spinner fa-spin" style="font-size:2rem;display:block;margin-bottom:1rem;"></i>
                    <p>Menunggu konfigurasi dari ESP32...</p>
                    <p style="font-size:0.85rem;">Pastikan ESP32 terhubung ke MQTT</p>
                </div>
            `;
        }
    });
}

function renderRelayGrid(containerId, names, startId) {
    const container = getElement(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    names.forEach((name, index) => {
        const relayId = startId + index;
        const isOn = relayStates[relayId] || false;
        const pinInfo = getPinInfo(relayId);
        const badge = startId <= 12 ? 'Lampu' : 'Perangkat';
        
        const card = document.createElement('div');
        card.className = `relay-card ${isOn ? 'on' : 'off'}`;
        card.id = `relay-${relayId}`;
        
        card.innerHTML = `
            <div class="relay-name">
                ${name}
                <span class="badge">${badge}</span>
                <span class="badge" style="background:#e8f4fd;color:#2c3e50;">GPIO ${pinInfo}</span>
                <span class="status-dot-small ${isOn ? 'on' : 'off'}" id="dot-${relayId}"></span>
            </div>
            <div class="relay-status">
                Status: <span class="${isOn ? 'on' : 'off'}" id="status-text-${relayId}">${isOn ? 'NYALA' : 'MATI'}</span>
            </div>
            <button class="btn-relay ${isOn ? 'on' : 'off'}" id="btn-${relayId}" onclick="toggleRelay(${relayId})">
                ${isOn ? 'MATIKAN' : 'NYALAKAN'}
            </button>
        `;
        
        container.appendChild(card);
    });
}

function renderSensorGrid() {
    const grid = getElement('sensorGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    const sensorLokasi = [
        { id: 'teras_depan', label: 'Teras Depan', icon: '🏠' },
        { id: 'ruang_tamu', label: 'Ruang Tamu', icon: '🛋️' },
        { id: 'teras_belakang', label: 'Teras Belakang', icon: '🌿' },
        { id: 'lantai_atas', label: 'Lantai Atas', icon: '🏢' }
    ];
    
    sensorLokasi.forEach((sensor) => {
        const card = document.createElement('div');
        card.className = 'sensor-card';
        card.id = `sensor-${sensor.id}`;
        card.innerHTML = `
            <span class="icon">${sensor.icon}</span>
            <h4>${sensor.label}</h4>
            <div class="sensor-detail">
                <div><div class="sensor-value suhu">--°C</div><span>Suhu</span></div>
                <div><div class="sensor-value kelembapan">--%</div><span>Kelembapan</span></div>
            </div>
            <small><i class="fas fa-clock"></i> Menunggu data...</small>
        `;
        grid.appendChild(card);
    });
}

// ============================================
// MQTT EVENTS
// ============================================

client.on("connect", () => {
    console.log("✅ [MQTT] Connected!");
    updateMQTTStatus(true);
    showToast('MQTT Terhubung! ✅', 'success');
    
    console.log("📡 [MQTT] Subscribing...");
    
    client.subscribe("home/esp/config");
    client.subscribe("home/esp/status");
    
    for (let i = 1; i <= 20; i++) {
        client.subscribe(`home/relay/${i}/status`);
        client.subscribe(`home/relay/${i}/ack`);
    }
    
    client.publish("home/dashboard/status", "ONLINE");
    client.publish("home/esp/config/request", "1");
});

client.on("offline", () => {
    console.warn("⚠️ [MQTT] Disconnected!");
    updateMQTTStatus(false);
    updateESPStatus(false);
    showToast('Koneksi MQTT terputus!', 'warning');
});

client.on("error", (err) => {
    console.error("❌ [MQTT] Error:", err);
    updateMQTTStatus(false);
});

// ============================================
// ✅ MESSAGE HANDLER
// ============================================

client.on("message", (topic, message) => {
    const data = message.toString();
    console.log(`📨 [MQTT] ${topic} -> ${data.substring(0, 80)}${data.length > 80 ? '...' : ''}`);

    // KONFIGURASI
    if (topic === "home/esp/config") {
        processConfig(data);
        return;
    }

    // ESP32 STATUS
    if (topic === "home/esp/status") {
        if (data === "ONLINE") {
            lastHeartbeat = Date.now();
            everOnline = true;
            updateESPStatus(true);
            showToast('ESP32 Online! ✅', 'success');
        }
        return;
    }

    // RELAY STATUS
    const relayMatch = topic.match(/home\/relay\/(\d+)\/status/);
    if (relayMatch) {
        const relayId = parseInt(relayMatch[1]);
        const isOn = data === "ON";
        
        relayStates[relayId] = isOn;
        updateRelayUI(relayId, isOn);
        
        if (pendingCommands[relayId]) {
            delete pendingCommands[relayId];
            showToast(`✅ ${getRelayName(relayId)} ${isOn ? 'NYALA' : 'MATI'}`, 'success', 2000);
        }
        return;
    }

    // ACK
    const ackMatch = topic.match(/home\/relay\/(\d+)\/ack/);
    if (ackMatch) {
        console.log(`✅ [ACK] Relay ${ackMatch[1]} confirmed`);
        return;
    }
});

// ============================================
// CHECK ESP32 ONLINE
// ============================================

setInterval(() => {
    const now = Date.now();
    if (!everOnline && now > 5000) {
        updateESPStatus(false);
    }
    if (everOnline && now - lastHeartbeat > 10000) {
        updateESPStatus(false);
        everOnline = false;
        console.warn("⚠️ ESP32 heartbeat timeout");
    }
}, 2000);

// ============================================
// NAVIGATION
// ============================================

document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        const menuId = this.dataset.menu;
        document.querySelectorAll('.menu-section').forEach(s => s.classList.remove('active'));
        const target = getElement(`menu${menuId}`);
        if (target) target.classList.add('active');
        const titleMap = { '1': 'Menu 1: Kontrol Lampu', '2': 'Menu 2: Data Sensor', '3': 'Menu 3: Kontrol Perangkat' };
        const titleEl = getElement('pageTitle');
        if (titleEl) titleEl.textContent = titleMap[menuId] || '';
        if (window.innerWidth <= 768) {
            const sidebar = getElement('sidebar');
            if (sidebar) sidebar.classList.remove('open');
        }
    });
});

document.querySelectorAll('.view-toggle').forEach(group => {
    group.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            const parent = this.closest('.view-toggle');
            parent.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const view = this.dataset.view;
            const menu = this.dataset.menu;
            const section = this.closest('.menu-section');
            if (menu === '1') {
                const manual = section.querySelector('#view-manual');
                const auto = section.querySelector('#view-auto');
                if (view === 'manual') { if (manual) manual.classList.add('active'); if (auto) auto.classList.remove('active'); }
                else { if (auto) auto.classList.add('active'); if (manual) manual.classList.remove('active'); }
            } else if (menu === '3') {
                const manual = section.querySelector('#view-manual3');
                const auto = section.querySelector('#view-auto3');
                if (view === 'manual') { if (manual) manual.classList.add('active'); if (auto) auto.classList.remove('active'); }
                else { if (auto) auto.classList.add('active'); if (manual) manual.classList.remove('active'); }
            }
        });
    });
});

const sidebarToggle = getElement('sidebarToggle');
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
        const sidebar = getElement('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
    });
}

// ============================================
// DATETIME
// ============================================

function updateDateTime() {
    const now = new Date();
    const el = getElement('datetime');
    if (el) {
        el.textContent = now.toLocaleString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ============================================
// INISIALISASI
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🏠 [APP] Dashboard Smart Home starting...');
    console.log('📡 Menunggu konfigurasi dari ESP32...');
    
    updateMQTTStatus(false);
    updateESPStatus(false);
    
    renderWaitingState();
    renderSensorGrid();
    
    console.log('✅ [APP] Dashboard siap');
});
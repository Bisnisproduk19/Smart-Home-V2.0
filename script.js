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
    clean: true
});

// ============================================
// KONFIGURASI 13 RELAY
// ============================================

const TOTAL_RELAY = 13;

const NAMA_RELAY = [
    'Teras Depan', 'Ruang Tamu Utama', 'Ruang Tamu 1',
    'Ruang Tamu 2', 'Kamar 1', 'Kamar 2',
    'Ruang Shalat', 'Dapur 1', 'Dapur 2',
    'Teras Belakang', 'Ruang 1', 'Kamar Mandi',
    'Pompa Air'
];

const PIN_GPIO = {
    1: 4, 2: 13, 3: 14, 4: 16, 5: 17, 6: 18,
    7: 19, 8: 23, 9: 25, 10: 26, 11: 27, 12: 32,
    13: 33
};

const relayLampu = NAMA_RELAY.slice(0, 12);
const relayPerangkat = NAMA_RELAY.slice(12, 13);

// ============================================
// KONFIGURASI SENSOR DHT22
// ============================================

const SENSOR_LOKASI = [
    { id: 'teras_depan', label: 'Teras Depan', icon: '🏠', pin: 34 },
    { id: 'ruang_tamu', label: 'Ruang Tamu', icon: '🛋️', pin: 35 },
    { id: 'teras_belakang', label: 'Teras Belakang', icon: '🌿', pin: 36 },
    { id: 'lantai_atas', label: 'Lantai Atas', icon: '🏢', pin: 39 }
];

let sensorData = {};

// ============================================
// STATE
// ============================================

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
    if (!el) console.warn('Element not found:', id);
    return el;
}

function showToast(message, type = 'info', duration = 3000) {
    const oldToast = document.querySelector('.toast-notification');
    if (oldToast) oldToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    const colors = {
        success: '#00b894',
        error: '#e74c3c',
        warning: '#f39c12',
        info: '#3498db',
        loading: '#f39c12'
    };
    
    toast.style.background = colors[type] || '#333';
    toast.innerHTML = `<span style="font-size:1.2rem;">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span> ${message}`;
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
// UPDATE SENSOR UI
// ============================================

function updateSensorUI(sensorId, suhu, kelembapan) {
    const card = getElement(`sensor-${sensorId}`);
    if (!card) return;
    
    const suhuEl = card.querySelector('.suhu');
    const kelembapanEl = card.querySelector('.kelembapan');
    const timeEl = card.querySelector('small');
    
    if (suhuEl) suhuEl.textContent = `${suhu || 0}°C`;
    if (kelembapanEl) kelembapanEl.textContent = `${kelembapan || 0}%`;
    if (timeEl) {
        const now = new Date();
        timeEl.innerHTML = `<i class="fas fa-clock"></i> ${now.toLocaleTimeString('id-ID')}`;
    }
}

// ============================================
// KONTROL RELAY
// ============================================

function sendRelayCommand(relayId, command) {
    if (!client || !client.connected) {
        showToast('❌ MQTT tidak terhubung!', 'error');
        return;
    }
    if (!espOnline) {
        showToast('⚠️ ESP32 offline!', 'warning');
        return;
    }
    if (relayId < 1 || relayId > TOTAL_RELAY) {
        showToast('❌ Relay tidak valid!', 'error');
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
    
    relayStates[relayId] = newState;
    updateRelayUI(relayId, newState);
    
    const topic = `home/relay/${relayId}/control`;
    client.publish(topic, command);
    console.log(`📤 [MQTT] ${topic} -> ${command}`);
    
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
    SENSOR_LOKASI.forEach((sensor) => {
        const card = document.createElement('div');
        card.className = 'sensor-card';
        card.id = `sensor-${sensor.id}`;
        card.innerHTML = `
            <span class="icon">${sensor.icon}</span>
            <h4>${sensor.label}</h4>
            <div class="sensor-detail">
                <div>
                    <div class="sensor-value suhu" id="suhu-${sensor.id}">--°C</div>
                    <span>Suhu</span>
                </div>
                <div>
                    <div class="sensor-value kelembapan" id="hum-${sensor.id}">--%</div>
                    <span>Kelembapan</span>
                </div>
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
    updateMQTTStatus(true);
    showToast('MQTT Terhubung! ✅', 'success');
    
    // Subscribe relay
    for (let i = 1; i <= TOTAL_RELAY; i++) {
        client.subscribe(`home/relay/${i}/status`);
        client.subscribe(`home/relay/${i}/ack`);
    }
    
    // Subscribe sensor
    SENSOR_LOKASI.forEach((sensor) => {
        client.subscribe(`home/sensor/${sensor.id}/suhu`);
        client.subscribe(`home/sensor/${sensor.id}/kelembapan`);
    });
    
    client.subscribe("home/esp/status");
    client.publish("home/dashboard/status", "ONLINE");
});

client.on("offline", () => {
    updateMQTTStatus(false);
    updateESPStatus(false);
    showToast('Koneksi MQTT terputus!', 'warning');
});

client.on("error", (err) => {
    console.error('MQTT Error:', err);
    updateMQTTStatus(false);
});

// ============================================
// MESSAGE HANDLER
// ============================================

client.on("message", (topic, message) => {
    const data = message.toString();

    // ESP Status
    if (topic === "home/esp/status") {
        if (data === "ONLINE") {
            lastHeartbeat = Date.now();
            everOnline = true;
            updateESPStatus(true);
            showToast('ESP32 Online! ✅', 'success');
        }
        return;
    }

    // Relay Status
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
        console.log(`✅ ACK Relay ${ackMatch[1]}`);
        return;
    }

    // Sensor Suhu
    const suhuMatch = topic.match(/home\/sensor\/(.+)\/suhu/);
    if (suhuMatch) {
        const sensorId = suhuMatch[1];
        const suhu = parseFloat(data);
        if (!sensorData[sensorId]) sensorData[sensorId] = {};
        sensorData[sensorId].suhu = suhu;
        updateSensorUI(sensorId, suhu, sensorData[sensorId].kelembapan || 0);
        return;
    }

    // Sensor Kelembapan
    const humMatch = topic.match(/home\/sensor\/(.+)\/kelembapan/);
    if (humMatch) {
        const sensorId = humMatch[1];
        const hum = parseFloat(data);
        if (!sensorData[sensorId]) sensorData[sensorId] = {};
        sensorData[sensorId].kelembapan = hum;
        updateSensorUI(sensorId, sensorData[sensorId].suhu || 0, hum);
        return;
    }
});

// ============================================
// CHECK ESP32 ONLINE
// ============================================

setInterval(() => {
    const now = Date.now();
    if (!everOnline && now > 5000) updateESPStatus(false);
    if (everOnline && now - lastHeartbeat > 10000) {
        updateESPStatus(false);
        everOnline = false;
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
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ============================================
// INITIALISASI
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🏠 [APP] Dashboard Smart Home starting...');
    console.log(`📌 Total Relay: ${TOTAL_RELAY}`);
    console.log(`📌 Sensor DHT22: ${SENSOR_LOKASI.length}`);
    
    for (let i = 1; i <= TOTAL_RELAY; i++) {
        relayStates[i] = false;
    }
    
    updateMQTTStatus(false);
    updateESPStatus(false);
    renderAll();
});

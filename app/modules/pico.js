function Module() {
    this.digitalValue = new Array(30).fill(0);
    this.analogValue = new Array(5).fill(0); // A0-A3 + Temp
    this.remoteDigitalValue = new Array(30).fill(0);

    this.sendBuffer = [];

    this.cmdQueue = {
        digital: new Array(30).fill(-1),
        pwm: new Array(30).fill(-1),
    };

    // Buffer for incoming data
    this.buffer = [];
}

Module.prototype.init = function (handler, config) {
    this.config = config;
};

Module.prototype.getProfiles = function () {
    return [
        {
            service: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
            characteristics: [
                {
                    uuid: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E', // RX (Write)
                    type: 'write',
                },
                {
                    uuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E', // TX (Notify)
                    type: 'notify',
                },
            ],
        },
    ];
};

Module.prototype.requestInitialData = function () {
    return null;
};

Module.prototype.checkInitialData = function (data, config) {
    return true;
};

Module.prototype.validateLocalData = function (data) {
    return true;
};

// Entry -> Hardware (Send Commands)
Module.prototype.handleRemoteData = function (handler) {
    // Check for Digital Write commands
    for (let i = 0; i < 30; i++) {
        const digitalVal = handler.read('digital_' + i);
        if (digitalVal !== undefined && this.remoteDigitalValue[i] !== digitalVal) {
            this.remoteDigitalValue[i] = digitalVal;
            this.cmdQueue.digital[i] = digitalVal;
        }
    }

    // Check for PWM Write commands (if any)
    for (let i = 0; i < 30; i++) {
        const pwmVal = handler.read('pwm_' + i);
        if (pwmVal !== undefined && this.cmdQueue.pwm[i] !== pwmVal) {
            this.cmdQueue.pwm[i] = pwmVal;
        }
    }
};

// Hardware -> Entry (Send Packets)
Module.prototype.requestLocalData = function () {
    const queryString = [];

    // Process Digital Commands
    for (let i = 0; i < 30; i++) {
        if (this.cmdQueue.digital[i] !== -1) {
            queryString.push(0xFF);
            queryString.push(0x01); // CMD: WRITE_DIGITAL
            queryString.push(i);
            queryString.push(0);
            queryString.push(this.cmdQueue.digital[i]);
            queryString.push(0xFE);

            this.cmdQueue.digital[i] = -1; // Clear command
        }
    }

    // Process PWM Commands
    for (let i = 0; i < 30; i++) {
        if (this.cmdQueue.pwm[i] !== -1) {
            // [START, PWM, PIN, VAL_H, VAL_L, END]
            const val = this.cmdQueue.pwm[i];
            queryString.push(0xFF);
            queryString.push(0x02); // CMD: WRITE_PWM
            queryString.push(i);
            queryString.push((val >> 8) & 0xFF);
            queryString.push(val & 0xFF);
            queryString.push(0xFE);

            this.cmdQueue.pwm[i] = -1; // Clear command
        }
    }

    if (this.config && this.config.hardware.type === 'bluetooth') {
        const commandQueue = arguments[0];
        if (commandQueue && queryString.length > 0) {
            commandQueue.push({
                key: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E', // RX Characteristic
                value: queryString
            });
        }
        return [];
    }

    return queryString;
};

// Hardware -> Entry (Receive Data)
Module.prototype.handleLocalData = function (data) {
    // Handle BLE Data
    if (this.config && this.config.hardware.type === 'bluetooth') {
        if (data.key === '6E400003-B5A3-F393-E0A9-E50E24DCCA9E') { // TX Characteristic
            data = data.value;
        } else {
            return;
        }
    }

    // Append new data to buffer
    for (let i = 0; i < data.length; i++) {
        this.buffer.push(data[i]);
    }

    // Process valid packets
    // Packet: [0xFF, CMD, PIN, VAL_H, VAL_L, 0xFE] (6 bytes)
    while (this.buffer.length >= 6) {
        // Find Start Byte
        if (this.buffer[0] !== 0xFF) {
            this.buffer.shift();
            continue;
        }

        // Check End Byte
        if (this.buffer[5] !== 0xFE) {
            this.buffer.shift();
            continue;
        }

        // Parse Packet
        const cmd = this.buffer[1];
        const pin = this.buffer[2];
        const valH = this.buffer[3];
        const valL = this.buffer[4];
        const value = (valH << 8) | valL;

        if (cmd === 0x03) { // READ_DIGITAL
            if (pin < 30) this.digitalValue[pin] = value;
        } else if (cmd === 0x04) { // READ_ANALOG
            if (pin < 5) this.analogValue[pin] = value;
        }

        // Remove processed packet
        this.buffer.splice(0, 6);
    }
};

// Hardware - > Entry (Update Block Values)
Module.prototype.requestRemoteData = function (handler) {
    for (let i = 0; i < 30; i++) {
        handler.write('digital_' + i, this.digitalValue[i]);
    }
    for (let i = 0; i < 5; i++) {
        handler.write('analog_' + i, this.analogValue[i]);
    }
};

Module.prototype.reset = function () {
    this.buffer = [];
    this.digitalValue.fill(0);
    this.analogValue.fill(0);
    this.cmdQueue.digital.fill(-1);
    this.cmdQueue.pwm.fill(-1);
};

module.exports = new Module();

function Module() {
    this.sp = null;
    this.sensorTypes = {
        RESET: 255,
        ALIVE: 0,
        DIGITAL: 1,
        ANALOG: 2,
        PWM: 3,
        SERVO_PIN: 4,
        TONE: 5,
        PULSEIN: 6,
        ULTRASONIC: 7,
        TIMER: 8,
        STEPPER: 9,
        DHTINIT: 10,  //a
        DHTTEMP: 11,  //b
        DHTHUMI: 12,  //c
        IRRINIT: 13,  //d
        IRREMOTE: 14,  //e
        LCD_INIT: 15,  //f
        LCD_PRINT: 16,  //10
        LCD_CLEAR: 17,  //11
    };

    this.actionTypes = {
        GET: 1,
        SET: 2,
        RESET: 3,
    };

    this.sensorValueSize = {
        FLOAT: 2,
        SHORT: 3,
    };

    // GET/SET 요청별로 타임스탬프를 분리 관리 (nano_ext 체리픽)
    // 키 형식: 'GET_${port}' 또는 'SET_${port}'
    this.digitalPortTimeList = {};

    this.lastAutoPollTime = 0;   // auto-poll 주기 추적
    this.activeSensorTimers = {}; // 활성 센서 타이머 (만료 관리)

    this.sensorData = {
        DIGITAL: {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
            '4': 0,
            '5': 0,
            '6': 0,
            '7': 0,
            '8': 0,
            '9': 0,
            '10': 0,
            '11': 0,
            '12': 0,
            '13': 0,
        },
        ANALOG: {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
            '4': 0,
            '5': 0,
        },
        PULSEIN: {},
        TIMER: 0,
        ULTRASONIC: 0,
        DHTTEMP: 0,
        DHTHUMI: 0,
        IRREMOTE: 0,
    };

    this.defaultOutput = {};
    this.recentCheckData = {};
    this.sendBuffers = [];

    this.lastTime = 0;
    this.lastSendTime = 0;
    this.isDraing = false;
    this.isNewConn = false; // 최초 연결시마다 포트구독을 재구독 하기 위해
    this.lastHeartbeatTime = 0;
    this.heartbeatInterval = 1000;
}

let sensorIdx = 0;

Module.prototype.init = function (handler, config) {
    this.config = config;
};

Module.prototype.getProfiles = function () {
    return [
        {
            service: '0000ffe0-0000-1000-8000-00805f9b34fb',
            characteristics: [
                {
                    uuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
                    type: ['read', 'write', 'notify'],
                },
            ],
        },
    ];
};

// 초기 연결성정(handshake과정) 완료 후에 호출됨
Module.prototype.setSerialPort = function (sp) {
    this.sp = sp;
    // nano_ext 체리픽: SerialPort 에러 이벤트 핸들러 등록
    if (this.sp && typeof this.sp.on === 'function') {
        this.sp.on('error', (err) => {
            console.error('SerialPort Error Handled:', err);
        });
    }
    this.reset();
};

/*
    연결 후 초기에 송신할 데이터가 필요한 경우 사용합니다.
    requestInitialData 를 사용한 경우 checkInitialData 가 필수입니다.
    이 두 함수가 정의되어있어야 로직이 동작합니다. 필요없으면 작성하지 않아도 됩니다.
    그러나, 현재는 하드웨어 선택 후 이 초기값 리턴되지 않으면, 펌웨어가 없는 것으로 간주해 신규 업로드를 시작하므로 보내야 함
*/
Module.prototype.requestInitialData = function () {
    if (!this.handshakeTryCount) {
        this.handshakeTryCount = 0;
    }

    if (this.handshakeTryCount > 1000) { // Limit retry count to avoid infinite loop
        return null;
    }

    this.handshakeTryCount++;
    this.isNewConn = true; // nano_ext 체리픽: 연결 시도마다 isNewConn 갱신

    // slave mode라서 hw로 먼저 초기 연결요청을 보내야 함
    return this.makeOutputBuffer(this.sensorTypes.RESET, 0, 0); // 최초 연결시, 하드웨어 초기화 수행
};

// 연결 후 초기에 수신받아서 정상연결인지를 확인해야하는 경우 사용합니다.
Module.prototype.checkInitialData = function (data, config) {
    // 하드웨어에서 온 데이터 처리
    // 패킷구조: ff 55 value_size valueLSB valueMSB port type tailer(CR=0d, LF=0a)
    // value_size: Float면 2, Short면 3
    // RESET에 대한 응당: ff 55 03 00 00 00 ff 0d 0a
    console.log('checkInitialData=', data);
    if (data && data.length >= 9 && data[0] === 0xFF && data[1] === 0x55 && data[6] === this.sensorTypes.RESET) {
        this.isNewConn = true;
        return true;
    }
    return undefined; // Do not return false, just return undefined to continue
};

Module.prototype.afterConnect = function (connector, cb) {
    // 연결 관리 주체인 인자값으로 넘겨진 Connector객체의 상태(connected)를 업데이트
    connector.connected = true;
    if (cb) {
        cb('connected');
    }
};

Module.prototype.validateLocalData = function (data) {
    return true;
};

// 하드웨어로부터 와서 처리된 데이터 -> 엔트리로 전달
// 밑단에서 먼저 handleLocalData() 호출 후 다음 순차적으로 이를 호출
Module.prototype.requestRemoteData = function (handler) {
    if (!this.sensorData) {
        return;
    }
    // console.log("SensorData:\n" + this.sensorData);

    // For port monitoring in Entry
    Object.keys(this.sensorData).forEach(key => {
        if (this.sensorData[key] != undefined) {
            if (key === 'DIGITAL') { // For legacy port reading
                for (let i = 0; i < Object.keys(this.sensorData[key]).length; i++) {
                    const value = this.sensorData[key][i];
                    handler.write(i.toString(), value);
                }
            } else if (key === 'ANALOG') { // For legacy port reading
                for (let i = 0; i < Object.keys(this.sensorData[key]).length; i++) {
                    const value = this.sensorData[key][i];
                    handler.write('a' + i, value);
                }
            } else {
                handler.write(key, this.sensorData[key]);
            }
        }
    });
};

// 엔트리로부터 받은 데이터에 대한 처리
Module.prototype.handleRemoteData = function (handler) {
    const self = this;
    const getDatas = handler.read('GET');
    const setDatas = handler.read('SET') || this.defaultOutput;
    const time = handler.read('TIME');
    let buffer = new Buffer([]);

    // HW에서 값을 읽어오기 요청
    if (getDatas) {
        const keys = Object.keys(getDatas);
        keys.forEach((key) => {
            let isSend = false;
            const dataObj = getDatas[key];

            if (
                typeof dataObj.port === 'string' ||
                typeof dataObj.port === 'number'
            ) {
                // nano_ext 체리픽: 'GET_port' prefix로 GET/SET 타임스탬프 분리
                const getPortKey = 'GET_' + dataObj.port;
                if (!self.digitalPortTimeList[getPortKey] || dataObj.time > self.digitalPortTimeList[getPortKey]) {
                    isSend = true;
                    self.digitalPortTimeList[getPortKey] = dataObj.time;
                }
            } else if (Array.isArray(dataObj.port)) { // For example, port of UltraSonic are array
                isSend = dataObj.port.every((p) => {
                    const getPortKey = 'GET_' + p;
                    return !self.digitalPortTimeList[getPortKey] || dataObj.time > self.digitalPortTimeList[getPortKey];
                });
                if (isSend) {
                    dataObj.port.forEach((p) => {
                        self.digitalPortTimeList['GET_' + p] = dataObj.time;
                    });
                }
            }

            // nano_ext 체리픽: composite key 파싱 (e.g. '1_2' = DIGITAL port 2)
            const device = (typeof key === 'string' && key.includes('_'))
                ? key.split('_')[0]
                : key;

            // nano_ext 체리픽: activeSensorTimers — 블록 사용 중인 센서 추적 (만료 관리용)
            const sensorTypeNo = Number(device);
            if ([self.sensorTypes.ULTRASONIC, self.sensorTypes.ANALOG, self.sensorTypes.DHTTEMP,
            self.sensorTypes.DHTHUMI, self.sensorTypes.IRREMOTE].includes(sensorTypeNo)) {
                if (dataObj.port !== undefined) {
                    if (!self.activeSensorTimers[sensorTypeNo]) {
                        self.activeSensorTimers[sensorTypeNo] = {};
                    }
                    const portKey = Array.isArray(dataObj.port) ? dataObj.port.join(',') : String(dataObj.port);
                    self.activeSensorTimers[sensorTypeNo][portKey] = new Date().getTime();
                }
            }

            if (isSend && !self.isRecentData(dataObj.port, device, dataObj.data, self.actionTypes.GET)) {
                const getPortKey = Array.isArray(dataObj.port)
                    ? 'GET_' + dataObj.port.join(',')
                    : 'GET_' + dataObj.port;
                self.recentCheckData[getPortKey] = {
                    type: device,
                    data: dataObj.data,
                    action: self.actionTypes.GET,
                    time: new Date().getTime(),
                };
                buffer = Buffer.concat([
                    buffer,
                    self.makeSensorReadBuffer(device, dataObj.port, dataObj.data),
                ]);
            }
        });
    }

    // HW에 값을 설정하기 요청
    if (setDatas) {
        Object.keys(setDatas).forEach((port) => {
            const data = setDatas[port];
            if (data) {
                // nano_ext 체리픽: SET 루프백 모니터링 — 펌웨어 응답 없이도 대시보드 즉시 반영
                if (data.type === self.sensorTypes.DIGITAL) {
                    self.sensorData.DIGITAL[port] = data.data;
                } else if (data.type === self.sensorTypes.PWM) {
                    self.sensorData.DIGITAL[port] = data.data;
                }

                // nano_ext 체리픽: 'SET_port' prefix로 타임스탬프 분리
                const setPortKey = 'SET_' + port;
                if (!self.digitalPortTimeList[setPortKey] || self.digitalPortTimeList[setPortKey] < data.time) {
                    // nano_ext 체리픽: SET Rate Limiting — 값이 같으면 true, 20ms 이내면 throttle
                    const recentStatus = self.isRecentData(port, data.type, data.data, self.actionTypes.SET);

                    if (recentStatus === true) {
                        // 동일 데이터: 타임스탬프만 갱신, HW 전송 생략
                        self.digitalPortTimeList[setPortKey] = data.time;
                    } else if (recentStatus === 'throttle') {
                        // Rate limited: 이번 틱 전송 보류, 다음 틱에 재시도
                    } else {
                        self.digitalPortTimeList[setPortKey] = data.time;
                        self.recentCheckData[setPortKey] = {
                            type: data.type,
                            data: data.data,
                            action: self.actionTypes.SET,
                            time: new Date().getTime(),
                        };
                        buffer = Buffer.concat([
                            buffer,
                            self.makeOutputBuffer(data.type, port, data.data),
                        ]);
                    }
                }
            }
        });
    }

    if (buffer.length) {
        this.sendBuffers.push(buffer);
    }
};

/**
 * nano_ext 체리픽: action(GET/SET) 파라미터 추가, GET 20ms Rate Limit, SET throttle 지원
 *
 * @param {number|number[]} port - 포트 번호 또는 포트 배열
 * @param {number|string}   type - sensorType 번호
 * @param {*}               data - 전송 데이터
 * @param {number}          action - actionTypes.GET(1) 또는 actionTypes.SET(2). 없으면 legacy 경로
 * @returns {boolean|'throttle'} true=중복/생략, false=전송, 'throttle'=잠시 대기
 **/
Module.prototype.isRecentData = function (port, type, data, action) {
    const now = new Date().getTime();
    const portStr = Array.isArray(port) ? port.join(',') : String(port);
    const checkKey = (action === this.actionTypes.GET ? 'GET_' : 'SET_') + portStr;

    // SET 요청: 동일 값이면 생략, 20ms 이내 변경이면 throttle
    if (action === this.actionTypes.SET) {
        if (this.recentCheckData[checkKey] &&
            this.recentCheckData[checkKey].action === this.actionTypes.SET &&
            this.recentCheckData[checkKey].type === type) {
            if (this.recentCheckData[checkKey].data === data) {
                return true; // 동일 값: 중복 전송 생략
            }
            // 값은 다르지만 20ms 이내: Rate Limit
            if (now - (this.recentCheckData[checkKey].time || 0) < 20) {
                return 'throttle';
            }
        }
        return false;
    }

    // GET 요청: 20ms(50Hz) 이내 같은 포트/타입 요청은 중복 억제
    if (action === this.actionTypes.GET) {
        if (this.recentCheckData[checkKey] &&
            this.recentCheckData[checkKey].action === this.actionTypes.GET &&
            this.recentCheckData[checkKey].type === type &&
            (now - (this.recentCheckData[checkKey].time || 0) < 20)) {
            return true;
        }
        return false;
    }

    // legacy 경로 (action 미전달 시 기존 동작 유지)
    return false;
};

/*
    엔트리에서 받아 처리된 데이터 -> 하드웨어로 전달
    slave 모드인 경우 duration 속성 간격으로 지속적으로 기기에 요청을 보냅니다.
    master 모드인 경우 하드웨어로부터 데이터 받자마자 바로 송신한다.
*/
Module.prototype.requestLocalData = function () {
    if (!this.sp) { return null; }

    if (this.config && this.config.hardware.type === 'ble') {
        const commandQueue = arguments[0];
        if (commandQueue && this.sendBuffers.length > 0) {
            const bleBuffer = this.sendBuffers.shift();
            commandQueue.push({
                key: '0000ffe1-0000-1000-8000-00805f9b34fb',
                value: bleBuffer
            });
        }
        return null;
    }

    // nano_ext 체리픽: activeSensorTimers 기반 Auto-Poll + 센서 만료 처리 (20ms 주기)
    const now = new Date().getTime();
    if (now - this.lastAutoPollTime > 20) {
        this.lastAutoPollTime = now;
        let autoBuffer = new Buffer([]);

        const activeTimers = this.activeSensorTimers || {};
        Object.keys(activeTimers).forEach((key) => {
            const ports = activeTimers[key];
            Object.keys(ports).forEach((portStr) => {
                if (now - ports[portStr] < 1000) {
                    // 1초 이내 블록 요청이 있으면 자동 재요청
                    const device = parseInt(key);
                    if (device === this.sensorTypes.ULTRASONIC) {
                        const portArr = portStr.split(',').map(Number);
                        autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(device, portArr)]);
                    } else {
                        autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(device, parseInt(portStr))]);
                    }
                } else {
                    // 1초 이상 블록 요청 없으면 해당 센서 값 0으로 초기화
                    const device = parseInt(key);
                    if (device === this.sensorTypes.ULTRASONIC) {
                        this.sensorData.ULTRASONIC = 0;
                    } else if (device === this.sensorTypes.DHTTEMP) {
                        this.sensorData.DHTTEMP = 0;
                    } else if (device === this.sensorTypes.DHTHUMI) {
                        this.sensorData.DHTHUMI = 0;
                    } else if (device === this.sensorTypes.IRREMOTE) {
                        this.sensorData.IRREMOTE = 0;
                    } else if (device === this.sensorTypes.ANALOG) {
                        if (this.sensorData.ANALOG) this.sensorData.ANALOG[portStr] = 0;
                    }
                    delete ports[portStr];
                }
            });
        });

        if (autoBuffer.length > 0) {
            this.sendBuffers.push(autoBuffer);
        } else {
            // 슬레이브 모드 하트비트: 자동 폴링 요청이 없을 때 1000ms 주기로 디지털 0번(RX) 상태 요청
            // 이를 통해 시리얼 입력을 트리거하여 대시보드 UI 갱신을 유도함
            if (now - this.lastHeartbeatTime > this.heartbeatInterval) {
                this.lastHeartbeatTime = now;
                this.sendBuffers.push(this.makeSensorReadBuffer(this.sensorTypes.DIGITAL, 0, this.actionTypes.GET));
            }
        }
    }

    if (!this.isDraing && this.sendBuffers.length > 0) {
        this.isDraing = true;
        this.sp.write(this.sendBuffers.shift(), () => {
            if (this.sp) {
                this.sp.drain(() => {
                    this.isDraing = false;
                });
            }
        });
    }

    return null;
};

Module.prototype.initProperties = function (obj) {
    const allProperties = Object.getOwnPropertyNames(obj);
    allProperties.forEach(property => {
        obj[property] = 0;
    });
};

/*
// 하드웨어에서 온 데이터 처리
패킷구조: ff 55 value_size valueLSB valueMSBㄱ port type tailer(CR=0d, LF=0a)
value_size: Float면 2, Short면 3
*/
Module.prototype.handleLocalData = function (data) {
    if (this.config && this.config.hardware.type === 'ble') {
        if (data.key === '0000ffe1-0000-1000-8000-00805f9b34fb') {
            data = data.value;
        } else {
            return;
        }
    }
    const datas = this.getDataByBuffer(data);
    // console.log(JSON.stringify(data, null, 2)); // Obj should be stringfied
    datas.forEach((data) => {
        if (data.length <= 4 || data[0] !== 255 || data[1] !== 85) { // Check the header
            console.log('Wrong header packet!!!');
            return;
        }
        const readData = data.subarray(2, data.length);
        let value;
        switch (readData[0]) {
            case this.sensorValueSize.FLOAT: {
                value = new Buffer(readData.subarray(1, 5)).readFloatLE();
                value = Math.round(value * 100) / 100;
                break;
            }
            case this.sensorValueSize.SHORT: {
                value = new Buffer(readData.subarray(1, 3)).readInt16LE();
                break;
            }
            default: {
                console.log('Other data type is not handled yet!!!');
                value = 0;
                break;
            }
        }

        const type = readData[readData.length - 1];
        const port = readData[readData.length - 2];

        switch (type) {
            case this.sensorTypes.RESET: {
                this.sensorData.RESET = value;
                console.log('RESET successfully!');
                break;
            }
            case this.sensorTypes.DIGITAL: {
                // this.initProperties(this.sensorData.DIGITAL)
                this.sensorData.DIGITAL[port] = value;
                break;
            }
            case this.sensorTypes.ANALOG: {
                // this.initProperties(this.sensorData.ANALOG)
                this.sensorData.ANALOG[port] = value;
                break;
            }
            case this.sensorTypes.PULSEIN: {
                this.sensorData.PULSEIN[port] = value;
                break;
            }
            case this.sensorTypes.ULTRASONIC: {
                this.sensorData.ULTRASONIC = value;
                break;
            }
            case this.sensorTypes.TIMER: {
                this.sensorData.TIMER = value;
                break;
            }
            case this.sensorTypes.DHTTEMP: {
                this.sensorData.DHTTEMP = value;
                break;
            }
            case this.sensorTypes.DHTHUMI: {
                this.sensorData.DHTHUMI = value;
                break;
            }
            case this.sensorTypes.IRREMOTE: {
                this.sensorData.IRREMOTE = value;
                break;
            }
            default: {
                console.log('No sensorTypes!!!');
                break;
            }
        }
    });
};

/*
ff 55 len idx action device port tailer (value) (dummy)
0  1  2   3   4      5      6    a      2bytes  10Bytes
len은 idx~데이터 까지의 길이 
tailer는 HW에서 송신시 Serial.println()에 의한 LF값(10)
idx은 아두이노 보드에서 실제 활용되지는 않음
*/
// 포트값(INPUT) 또는 구독 요청 만들기
Module.prototype.makeSensorReadBuffer = function (device, port, data) {
    let buffer;
    const value = new Buffer(2);
    const dummy = new Buffer([10]); // 10Bytes

    if (typeof (device) == 'string') {
        device = parseInt(device); // String to Number for switch-case
    }
    switch (device) {
        case this.sensorTypes.ULTRASONIC:
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.GET,
                device,
                port[0],
                port[1],
                10, // tailer
            ]);
            console.log('\x1b[31mread ultrasonic\x1b[0m');
            break;
        case this.sensorTypes.DHTTEMP:
        case this.sensorTypes.DHTHUMI:
        case this.sensorTypes.IRREMOTE:
        case this.sensorTypes.ANALOG: // AnalogRead
        case this.sensorTypes.DIGITAL: // DigitalRead
            buffer = new Buffer([
                255,
                85,
                5,
                sensorIdx,
                this.actionTypes.GET,
                device,
                port,
                10,
            ]);
            console.log(`\x1b[31mread port (device: ${device}, port: ${port})\x1b[0m`);
            break;
        default:
            console.log('Subsription request by default sensorType!!');
            buffer = new Buffer([
                255,
                85,
                7,  // buffer 이후 덧붙혀지는 value 크기를 포함
                sensorIdx,
                this.actionTypes.GET,
                device,
                port,
                10,
            ]);
            value.writeInt16LE(data); // 2Bytes
            buffer = Buffer.concat([buffer, value, dummy]);
            break;
    }
    sensorIdx++;
    if (sensorIdx > 254) {
        sensorIdx = 0;
    }

    console.log('GetCmdBuf=', buffer);
    return buffer;
};

/*
ff   55   len idx action device port value  (etc) dummy
0    1    2   3   4      5      6    7      8
0xff 0x55 0x6 0x0 0x2    0xa    0x9  2bytes 0x0   10Bytes
len은 idx~데이터 까지의 길이 
*/
// 실행요청(OUTPUT) 만들기 
Module.prototype.makeOutputBuffer = function (device, port, data) {
    let buffer;
    const value = new Buffer(2);
    const dummy = new Buffer([10]);
    switch (device) {
        case this.sensorTypes.RESET:
            value.writeInt16LE(data); // 2byptes
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.RESET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
            break;
        case this.sensorTypes.LCD_INIT:
        case this.sensorTypes.LCD_CLEAR:
        case this.sensorTypes.IRRINIT:
        case this.sensorTypes.DHTINIT:
        case this.sensorTypes.SERVO_PIN:
        case this.sensorTypes.DIGITAL:
        case this.sensorTypes.PWM: {
            value.writeInt16LE(data); // 2byptes
            buffer = new Buffer([
                255,
                85,
                6,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, dummy]);
            console.log(`\x1b[31mwrite init (${device})\x1b[0m`);
            break;
        }
        case this.sensorTypes.TONE: {
            const time = new Buffer(2);
            if ($.isPlainObject(data)) {
                value.writeInt16LE(data.value);
                time.writeInt16LE(data.duration);
            } else {
                value.writeInt16LE(0);
                time.writeInt16LE(0);
            }
            buffer = new Buffer([
                255,
                85,
                8,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, value, time, dummy]);
            console.log('\x1b[31mwrite tone\x1b[0m');
            break;
        }
        case this.sensorTypes.STEPPER: {
            const port1 = new Buffer(2);
            const port2 = new Buffer(2);
            const port3 = new Buffer(2);
            const port4 = new Buffer(2);
            const speed = new Buffer(2);
            const steps = new Buffer(2);
            if ($.isPlainObject(data)) {
                port1.writeInt16LE(data.port1);
                port2.writeInt16LE(data.port2);
                port3.writeInt16LE(data.port3);
                port4.writeInt16LE(data.port4);
                speed.writeInt16LE(data.speed);
                steps.writeInt16LE(data.steps);
            } else {
                port1.writeInt16LE(0);
                port2.writeInt16LE(0);
                port3.writeInt16LE(0);
                port4.writeInt16LE(0);
                speed.writeInt16LE(0);
                steps.writeInt16LE(0);
            }
            buffer = new Buffer([
                255,
                85,
                16,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);
            buffer = Buffer.concat([buffer, port1, port2, port3, port4, speed, steps, dummy]);
            console.log('\x1b[31mwrite stepper\x1b[0m');
            break;
        }
        case this.sensorTypes.LCD_PRINT: {
            let text = null;
            const row = Buffer(1);
            const column = Buffer(1);
            let textLen = 0;
            const bufLen = Buffer(1);

            if ($.isPlainObject(data)) {
                // numeric 데이터로 들어오는 경우가 있으므로, 문자열로 변경하기
                textLen = ('' + data.text).length;
                text = Buffer.from("" + data.text);
                row.writeInt8(data.row);
                bufLen.writeInt8(textLen);
                column.writeInt8(data.column);
            } else {
                textLen = 0;
                text = Buffer.from('');
                row.writeInt8(0);
                bufLen.writeInt8(textLen);
                column.writeInt8(0);
            }

            buffer = new Buffer([
                255,
                85,
                4 + 3 + textLen,
                sensorIdx,
                this.actionTypes.SET,
                device,
                port,
            ]);

            buffer = Buffer.concat([buffer, row, column, bufLen, text, dummy]);
            console.log('\x1b[31mwrite lcd\x1b[0m');
            break;
        }
    }

    console.log('SetCmdBuf=', buffer);
    return buffer;
};

Module.prototype.getDataByBuffer = function (buffer) {
    const datas = [];
    let lastIndex = 0;
    buffer.forEach((value, idx) => {
        if (value == 13 && buffer[idx + 1] == 10) { // Serial.println()에 의한 CR값(0x0D 0x0A)
            datas.push(buffer.subarray(lastIndex, idx));
            lastIndex = idx + 2;
        }
    });

    return datas;
};

Module.prototype.disconnect = function (connect) {
    if (connect) {
        console.log('disconnect called with connect type:', typeof connect);
        // connect가 connector 객체인 경우에만 close 호출 (중복 close 방지 및 Lock Port 방지)
        if (typeof connect.close === 'function') {
            if (connect.hwModule || typeof connect.send === 'function') {
                console.log('disconnect: calling connect.close() (Connector)');
                connect.close();
            } else {
                console.log('disconnect: skipping connect.close() (SerialPort or other)');
            }
        }
    } else {
        console.log('disconnect called without connect argument');
    }

    if (this.sp) {
        delete this.sp;
    }

    // Clean up internal state
    this.sendBuffers = [];
    this.isDraing = false;
    this.isNewConn = false;
    this.handshakeTryCount = 1001; // 1001(실패값)으로 만들어서 패킷을 보내지 않도록 함, 실제 초기화는 reset()에서 함
};

Module.prototype.reset = function () {
    this.sendBuffers = [];
    this.lastTime = 0;
    this.lastSendTime = 0;
    this.sensorData.TIMER = 0;
    this.digitalPortTimeList = {};
    this.isDraing = false;
    this.isNewConn = false;
    this.handshakeTryCount = 0;
    sensorIdx = 0;

    // nano_ext 체리픽: 재연결 시 센서 구독/상태 전부 초기화
    this.sensorData.PULSEIN = {};
    this.recentCheckData = {};      // 구독 재요청 보장
    this.lastAutoPollTime = 0;      // auto-poll 타이머 리셋
    this.activeSensorTimers = {};   // 활성 센서 타이머 초기화
};

// nano_ext 체리픽: 연결 종료 시 모든 출력 핀 OFF + 상태 초기화
Module.prototype.setZero = function () {
    let buffer = new Buffer([]);
    // 모든 디지털 포트 OFF (2~13, 단 시리얼 0~1 및 LED 13 제외)
    for (let i = 2; i <= 12; i++) {
        buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.DIGITAL, i, 0)]);
    }
    // 버저 정지
    buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.TONE, 4, { value: 0, duration: 0 })]);
    // LCD 클리어
    buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.LCD_CLEAR, 0, 0)]);

    if (this.sp) {
        this.sp.write(buffer);
    }
    this.recentCheckData = {};
    this.reset();
};

Module.prototype.lostController = function (connector, stateCallback) {
    // 아무일도 안하지만, 해당 함수가 선언되면 하드웨어에서 시간 내 응답없으면 연결 종료시키는 lostTimer가 선언되지 않음
};

module.exports = new Module();

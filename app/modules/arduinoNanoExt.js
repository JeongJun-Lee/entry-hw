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
        MPU: 18,
        MOTOR: 19,
        SOUND: 20,
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

    // Entry.js쪽에서 특정 port(예를들어 stepper motor 14번)를 사용한다고, 여기에 반영 필요!
    // 맨 처음 0번째는 세지 않음(배열1~13번째 값이 포트1~13과 맵핑), Stepper 14, LCD 15
    this.digitalPortTimeList = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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
            '6': 0,
            '7': 0,
        },
        PULSEIN: {},
        TIMER: 0,
        ULTRASONIC: 0,
        DHTTEMP: 0,
        DHTHUMI: 0,
        IRREMOTE: 0,
        SOUND: 0,
        accelX: 0,
        accelY: 0,
        accelZ: 0,
        gyroX: 0,
        gyroY: 0,
        gyroZ: 0,
        roll: 0,
        pitch: 0,
        yaw: 0,
        M1: 0,
        M2: 0,
    };

    this.defaultOutput = {};
    this.recentCheckData = {};
    this.sendBuffers = [];

    this.lastTime = 0;
    this.lastSendTime = 0;
    this.isDraing = false;
    this.isNewConn = false; // 최초 연결시마다 포트구독을 재구독 하기 위해
    this.lastMpuTime = 0;
}

let sensorIdx = 0;

Module.prototype.init = function (handler, config) { };

Module.prototype.setSerialPort = function (sp) {
    this.sp = sp;
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
    this.isNewConn = true;
    // slave mode라서 hw에서 신호를 받아야 연결성립
    return this.makeOutputBuffer(this.sensorTypes.RESET, 0, 0); // 최초 연결시, 하드웨어 초기화 수행
};

// 연결 후 초기에 수신받아서 정상연결인지를 확인해야하는 경우 사용합니다.
Module.prototype.checkInitialData = function (data, config) {
    console.log("Initial Data arrived!!!, But we don't use it now");
    return true;
};

Module.prototype.afterConnect = function (that, cb) {
    that.connected = true;
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
    const self = this;
    if (!self.sensorData) {
        return;
    }

    // 포트별 데이터를 모니터링 키에 매핑
    Object.keys(this.sensorData).forEach((key) => {
        if (self.sensorData[key] !== undefined) {
            if (key === 'DIGITAL') {
                for (let i = 0; i < 14; i++) {
                    const value = self.sensorData[key][i];
                    if (value !== undefined) {
                        handler.write(i.toString(), value);
                    }
                }
            } else if (key === 'ANALOG') {
                for (let i = 0; i < 8; i++) {
                    const value = self.sensorData[key][i];
                    if (i !== 4 && i !== 5) {
                        handler.write('a' + i, value);
                    }
                }
            } else {
                if (key !== 'M1' && key !== 'M2') {
                    handler.write(key, self.sensorData[key]);
                } else {
                    const port = (key === 'M1' ? '9' : '10');
                    handler.write(port, self.sensorData[key]);
                }
            }
        }
    });
};

Module.prototype.handleRemoteData = function (handler) {
    const self = this;
    const getDatas = handler.read('GET');
    const setDatas = handler.read('SET') || this.defaultOutput;
    let buffer = new Buffer([]);

    if (getDatas) {
        // MPU 데이터 강제 요청 (블록 사용 안해도 상시 모니터링)
        // 통신 부하를 획기적으로 줄이기 위해 500ms(2Hz) 주기로만 요청 (대시보드 표시용)
        const now = new Date().getTime();
        if (!getDatas[self.sensorTypes.MPU] && (now - self.lastMpuTime > 500)) {
            getDatas[self.sensorTypes.MPU] = {
                port: 0,
                time: now,
            };
            self.lastMpuTime = now;
        } else if (getDatas[self.sensorTypes.MPU]) {
            // MPU 블록이 직접 사용될 때는 블록 실행 주기에 맞춤
            self.lastMpuTime = now;
        }

        Object.keys(getDatas).forEach((key) => {
            let isSend = false;
            const dataObj = getDatas[key];
            if (typeof dataObj.port === 'string' || typeof dataObj.port === 'number') {
                if (dataObj.time > self.digitalPortTimeList[dataObj.port]) {
                    isSend = true;
                    self.digitalPortTimeList[dataObj.port] = dataObj.time;
                }
            } else if (Array.isArray(dataObj.port)) {
                isSend = dataObj.port.every(p => dataObj.time > self.digitalPortTimeList[p]);
                if (isSend) dataObj.port.forEach(p => self.digitalPortTimeList[p] = dataObj.time);
            }
            if (isSend && !self.isRecentData(dataObj.port, key, dataObj.data, self.actionTypes.GET)) {
                self.recentCheckData[dataObj.port] = {
                    type: key,
                    data: dataObj.data,
                    action: self.actionTypes.GET,
                    time: new Date().getTime()
                };
                buffer = Buffer.concat([buffer, self.makeSensorReadBuffer(key, dataObj.port, dataObj.data)]);
            }
        });
    }

    if (setDatas) {
        Object.keys(setDatas).forEach((port) => {
            const data = setDatas[port];
            if (data) {
                // 화면 모니터링을 위한 루프백 업데이트 (펌웨어 응답이 없어도 대시보드에 값 반영)
                if (data.type === self.sensorTypes.DIGITAL) {
                    self.sensorData.DIGITAL[port] = data.data;
                } else if (data.type === self.sensorTypes.PWM) {
                    self.sensorData.DIGITAL[port] = data.data; // PWM은 디지털 핀 모니터링에서도 보여야 함
                } else if (data.type === self.sensorTypes.ANALOG) {
                    self.sensorData.ANALOG[port] = data.data;
                } else if (data.type === self.sensorTypes.MOTOR) {
                    const dir = (data.data >> 8) & 0xFF;
                    const speed = data.data & 0xFF;
                    const val = dir == 0 ? speed : -speed;
                    // 블록은 '1','2'를 사용하고, 모니터링 내부 변수는 M1/M2(물리9,10)를 사용
                    if (port == '1' || port == '9') {
                        self.sensorData.M1 = val;
                    } else if (port == '2' || port == '10') {
                        self.sensorData.M2 = val;
                    }
                }

                // 시간 순서가 맞는지 확인 (최신 명령 보장)
                if (self.digitalPortTimeList[port] < data.time) {
                    self.digitalPortTimeList[port] = data.time;

                    // 출력 명령(SET)은 값이 바뀔 때만 전송 (불필요한 트래픽 제거)
                    if (!self.isRecentData(port, data.type, data.data, self.actionTypes.SET)) {
                        self.recentCheckData[port] = {
                            type: data.type,
                            data: data.data,
                            action: self.actionTypes.SET,
                            time: new Date().getTime()
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
 * 기존에 수신했던 데이터인가
 * 기존에 수신했던 데이터인지 확인합니다. 예를들어 무한루프에서 상태가 변하지 않을 경우 추가로 신호를 하드웨어에 보내거나,
 * 또는 포트 구독의 경우 등 불필요한 오버헤드를 발생시킬 필요가 없으므로, 같은 신호에 대해서는 중복으로 보내지 않도록 만듭니다.
 * 하지만, Tone과 같이 같은 신호라도 출력데이터를 보내야하므로 별도의 예외처리가 필요합니다.
**/
Module.prototype.isRecentData = function (port, type, data, action) {
    const that = this;
    let isRecent = false;
    const now = new Date().getTime();

    // GET 요청(센서 읽기)은 100ms(10Hz) 주기로 폴링 제한 (UART 부하 방지)
    if (action === this.actionTypes.GET) {
        if (this.recentCheckData[port] &&
            this.recentCheckData[port].action === this.actionTypes.GET &&
            this.recentCheckData[port].type === type &&
            (now - (this.recentCheckData[port].time || 0) < 100)) {
            return true;
        }
        return false;
    }

    if (type == this.sensorTypes.ULTRASONIC) {
        const portString = port.toString();
        let isGarbageClear = false;
        Object.keys(this.recentCheckData).forEach((key) => {
            const recent = that.recentCheckData[key];
            if (key === portString) {

            }
            if (key !== portString &&
                (recent.type == that.sensorTypes.ULTRASONIC)) {
                delete that.recentCheckData[key];
                isGarbageClear = true;
            }
        });

        if ((port in this.recentCheckData && isGarbageClear) || !(port in this.recentCheckData) ||
            this.isNewConn) {
            isRecent = false;
            this.isNewConn = false; // Re-subscribe when hw is connected newly
        } else {
            isRecent = true;
        }
    } else if (port in this.recentCheckData && type != this.sensorTypes.TONE) { // 예외로 계속 데이터 보내야 하는 경우에 추가!
        if (
            this.recentCheckData[port].type === type &&
            JSON.stringify(this.recentCheckData[port].data) === JSON.stringify(data) // 데이터까지 동일해야 동일 데이터로 간주
        ) {
            console.log(`isRecent is True, type= ${type}, data= ` + JSON.stringify(this.recentCheckData[port].data));
            isRecent = true;
        }
    }

    if (type == this.sensorTypes.MPU) {
        isRecent = false;
    }

    // SET 요청(출력)은 값이 같으면 전송하지 않음 (Deduplication)
    if (action === this.actionTypes.SET) {
        if (this.recentCheckData[port] &&
            this.recentCheckData[port].action === this.actionTypes.SET &&
            this.recentCheckData[port].type === type &&
            this.recentCheckData[port].data === data) {
            return true;
        }
        return false;
    }

    return isRecent;
};

/*
    엔트리에서 받아 처리된 데이터 -> 하드웨어로 전달
    slave 모드인 경우 duration 속성 간격으로 지속적으로 기기에 요청을 보냅니다.
    master 모드인 경우 하드웨어로부터 데이터 받자마자 바로 송신한다.
*/
Module.prototype.requestLocalData = function () {
    const self = this;

    // 자동 폴링(Auto-Poll) 구현: 100ms마다 센서 전체 요청
    const now = new Date().getTime();
    if (now - this.lastAutoPollTime > 100) {
        this.lastAutoPollTime = now;

        let autoBuffer = new Buffer([]);
        // 아날로그 전체 (A0~A7)
        for (let i = 0; i < 8; i++) {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.ANALOG, i)]);
        }
        // 디지털 전체 (D0~D13)
        for (let i = 0; i < 14; i++) {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.DIGITAL, i)]);
        }

        // 엔트리 블록에서 요청된 소리 센서(SOUND), DHT, IR 리모컨이 있다면 버퍼에 추가조회
        this.activeSoundPorts.forEach((soundPort) => {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.SOUND, soundPort)]);
        });

        this.activeDhtTempPorts.forEach((dhtPort) => {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.DHTTEMP, dhtPort)]);
        });

        this.activeDhtHumiPorts.forEach((dhtPort) => {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.DHTHUMI, dhtPort)]);
        });

        this.activeIrremotePorts.forEach((irPort) => {
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.IRREMOTE, irPort)]);
        });

        // 엔트리 블록에서 초음파 센서(ULTRASONIC) 요청이 한 번이라도 있었다면 포트에 맞게 버퍼 추가조회
        if (this.activeUltrasonicPorts && this.activeUltrasonicPorts.length >= 2) {
            const trig = this.activeUltrasonicPorts[0];
            const echo = this.activeUltrasonicPorts[1];
            autoBuffer = Buffer.concat([autoBuffer, this.makeSensorReadBuffer(this.sensorTypes.ULTRASONIC, trig, echo)]);
        }

        this.sendBuffers.push(autoBuffer);
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

    // 버퍼가 너무 쌓이면(100개 초과) 지연 방지를 위해 초기화
    if (this.sendBuffers.length > 100) {
        this.sendBuffers = [];
    }
};

Module.prototype.initProperties = function (obj) {
    const allProperties = Object.getOwnPropertyNames(obj);
    allProperties.forEach(property => {
        obj[property] = 0;
    });
};

/*
// 하드웨어에서 온 데이터 처리
패킷구조: ff 55 value_size value port type tailer(a)
value_size: Float면 2, Short면 3
*/
Module.prototype.handleLocalData = function (data) {
    const self = this;
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
            case self.sensorValueSize.FLOAT: {
                value = new Buffer(readData.subarray(1, 5)).readFloatLE();
                value = Math.round(value * 100) / 100;
                break;
            }
            case self.sensorValueSize.SHORT: {
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
            case self.sensorTypes.RESET: {
                self.sensorData.RESET = value;
                console.log('RESET successfully!');
                break;
            }
            case self.sensorTypes.DIGITAL: {
                // this.initProperties(self.sensorData.DIGITAL)
                if (port === 8) {
                    // 조이스틱 버튼(8번 핀)은 하드웨어에서 안 눌렀을 때 1, 눌렀을 때 0이 들어옴.
                    // 모니터 대시보드에서 좀 더 직관적인 (안 누름 0, 누름 1) 값으로 보여주기 위해 뒤집음
                    self.sensorData.DIGITAL[port] = value === 0 ? 1 : 0;
                } else {
                    self.sensorData.DIGITAL[port] = value;
                }
                break;
            }
            case self.sensorTypes.ANALOG: {
                // this.initProperties(self.sensorData.ANALOG)
                self.sensorData.ANALOG[port] = value;
                break;
            }
            case self.sensorTypes.PULSEIN: {
                self.sensorData.PULSEIN[port] = value;
                break;
            }
            case self.sensorTypes.ULTRASONIC: {
                self.sensorData.ULTRASONIC = value;
                break;
            }
            case self.sensorTypes.TIMER: {
                self.sensorData.TIMER = value;
                break;
            }
            case self.sensorTypes.DHTTEMP: {
                self.sensorData.DHTTEMP = value;
                break;
            }
            case self.sensorTypes.DHTHUMI: {
                self.sensorData.DHTHUMI = value;
                break;
            }
            case self.sensorTypes.IRREMOTE: {
                self.sensorData.IRREMOTE = value;
                break;
            }
            case self.sensorTypes.SOUND: {
                self.sensorData.SOUND = value;
                break;
            }
            case self.sensorTypes.MPU: {
                const keys = [
                    'accelX',
                    'accelY',
                    'accelZ',
                    'gyroX',
                    'gyroY',
                    'gyroZ',
                    'roll',
                    'pitch',
                    'yaw',
                ];
                if (port >= 0 && port < keys.length) {
                    self.sensorData[keys[port]] = value;
                }
                break;
            }
            case self.sensorTypes.MOTOR: {
                const keys = ['M1', 'M2'];
                if (port >= 0 && port < keys.length) {
                    self.sensorData[keys[port]] = value;
                }
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
        case this.sensorTypes.SOUND: // SoundRead
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
        case this.sensorTypes.MOTOR:
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
        if (typeof connect.close === 'function') {
            if (connect.hwModule || typeof connect.send === 'function') {
                connect.close();
            }
        }
    }

    if (this.sp) {
        delete this.sp;
    }
    // Clean up internal state
    this.sendBuffers = [];
    this.isDraing = false;
    this.isNewConn = false;
    this.handshakeTryCount = 1001;
};

Module.prototype.reset = function () {
    this.sendBuffers = [];
    this.lastTime = 0;
    this.lastSendTime = 0;
    this.isDraing = false;
    this.isNewConn = false;
    this.lastAutoPollTime = 0;
    this.activeUltrasonicPorts = null; // 초음파 센터 활성 포트 (배열: [trig, echo] 또는 null)
    this.activeSoundPorts = new Set(); // 소리 센서 활성 포트 저장

    // DHT, IR Remote 센서 활성 포트 추적
    this.activeDhtTempPorts = new Set();
    this.activeDhtHumiPorts = new Set();
    this.activeIrremotePorts = new Set();

    this.handshakeTryCount = 0;
    this.lastMpuTime = 0;
    sensorIdx = 0;

    // 센서 데이터 초기화 (이전 출력 값이 입력으로 오해받지 않도록)
    this.sensorData.DIGITAL = {
        '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0,
        '7': 0, '8': 0, '9': 0, '10': 0, '11': 0, '12': 0, '13': 0,
    };
    this.sensorData.ANALOG = {
        '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0,
    };
    this.sensorData.PULSEIN = {};
    this.sensorData.SOUND = 0;
};

Module.prototype.setZero = function () {
    let buffer = new Buffer([]);
    // 모든 디지털 포트 OFF (2~13)
    for (let i = 2; i <= 13; i++) {
        buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.DIGITAL, i, 0)]);
    }
    // 모터 정지 (9, 10은 위 루프에 포함되어 digitalWrite(0) 됨)
    buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.MOTOR, 1, 0)]);
    buffer = Buffer.concat([buffer, this.makeOutputBuffer(this.sensorTypes.MOTOR, 2, 0)]);
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

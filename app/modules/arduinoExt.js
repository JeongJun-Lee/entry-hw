function Module() {
    this.sp = null;
    this.sensorTypes = {
        RESET:    255,
        ALIVE:      0,
        DIGITAL:    1,
        ANALOG:     2,
        PWM:        3,
        SERVO_PIN:  4,
        TONE:       5,
        PULSEIN:    6,
        ULTRASONIC: 7,
        TIMER:      8,
        STEPPER:    9,
        DHTINIT:   10,  //a
        DHTTEMP:   11,  //b
        DHTHUMI:   12,  //c
        IRRINIT:   13,  //d
        IRREMOTE:  14,  //e
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
    this.digitalPortTimeList = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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
        TIMER:      0,
        ULTRASONIC: 0,
        DHTTEMP:    0,
        DHTHUMI:    0,
        IRREMOTE:   0,
    };

    this.defaultOutput = {};
    this.recentCheckData = {};
    this.sendBuffers = [];

    this.lastTime = 0;
    this.lastSendTime = 0;
    this.isDraing = false;
    this.isNewConn = false; // 최초 연결시마다 포트구독을 재구독 하기 위해
}

let sensorIdx = 0;

Module.prototype.init = function(handler, config) {};

Module.prototype.setSerialPort = function(sp) {
    const self = this;
    this.sp = sp;
};

/*
    연결 후 초기에 송신할 데이터가 필요한 경우 사용합니다.
    requestInitialData 를 사용한 경우 checkInitialData 가 필수입니다.
    이 두 함수가 정의되어있어야 로직이 동작합니다. 필요없으면 작성하지 않아도 됩니다.
    그러나, 현재는 하드웨어 선택 후 이 초기값 리턴되지 않으면, 펌웨어가 없는 것으로 간주해 신규 업로드를 시작하므로 보내야 함
*/
Module.prototype.requestInitialData = function() {
    this.isNewConn = true;
    // slave mode라서 hw에서 신호를 받아야 연결성립
    return this.makeOutputBuffer(this.sensorTypes.RESET, 0, 0); // 최초 연결시, 하드웨어 초기화 수행
};

// 연결 후 초기에 수신받아서 정상연결인지를 확인해야하는 경우 사용합니다.
Module.prototype.checkInitialData = function(data, config) {
    console.log("Initial Data arrived!!!, But we don't use it now");
    return true;
};

Module.prototype.afterConnect = function(that, cb) {
    that.connected = true;
    if (cb) {
        cb('connected');
    }
};

Module.prototype.validateLocalData = function(data) {
    return true;
};

// 하드웨어로부터 와서 처리된 데이터 -> 엔트리로 전달
// 밑단에서 먼저 handleLocalData() 호출 후 다음 순차적으로 이를 호출
Module.prototype.requestRemoteData = function(handler) {
    const self = this;
    if (!self.sensorData) {
        return;
    }
    // console.log("SensorData:\n" + self.sensorData);

    // For port monitoring in Entry
    Object.keys(this.sensorData).forEach(key => {
        if (self.sensorData[key] != undefined) {
            if (key === 'DIGITAL') { // For legacy port reading
                for (let i = 0; i < Object.keys(self.sensorData[key]).length; i++) {
                    const value = self.sensorData[key][i];
                    handler.write(i, value);
                }
            } else if (key === 'ANALOG') { // For legacy port reading
                for (let i = 0; i < Object.keys(self.sensorData[key]).length; i++) {
                    const value = self.sensorData[key][i];
                    handler.write('a' + i, value);
                }
            } else {
                handler.write(key, self.sensorData[key]); 
            }
        }
    });
};

// 엔트리에서 받은 데이터에 대한 처리
Module.prototype.handleRemoteData = function(handler) {
    const self = this;
    const getDatas = handler.read('GET');
    const setDatas = handler.read('SET') || this.defaultOutput;
    const time = handler.read('TIME');
    let buffer = new Buffer([]);

    if (getDatas) {
        const keys = Object.keys(getDatas);
        keys.forEach((key) => {
            let isSend = false;
            const dataObj = getDatas[key];
            // To chceck if Entry sent the block really
            // console.log(`getDatas: key=${key} port=${dataObj.port} data=${dataObj.data}`); 
            if (
                typeof dataObj.port === 'string' ||
                typeof dataObj.port === 'number'
            ) {
                const time = self.digitalPortTimeList[dataObj.port];
                if (dataObj.time > time) {
                    isSend = true;
                    self.digitalPortTimeList[dataObj.port] = dataObj.time;
                }
                prevKey = key;
            } else if (Array.isArray(dataObj.port)) { // For example, UltraSonic
                isSend = dataObj.port.every((port) => {
                    const time = self.digitalPortTimeList[port];
                    return dataObj.time > time;
                });

                if (isSend) {
                    dataObj.port.forEach((port) => {
                        self.digitalPortTimeList[port] = dataObj.time;
                    });
                }
            }
            if (isSend) {
                if (!self.isRecentData(dataObj.port, key, dataObj.data)) {
                    self.recentCheckData[dataObj.port] = {
                        type: key,
                        data: dataObj.data,
                    };
                    buffer = Buffer.concat([
                        buffer,
                        self.makeSensorReadBuffer(
                            key,
                            dataObj.port,
                            dataObj.data,
                        ),
                    ]);
                }
            }
        });
    }

    if (setDatas) {
        const setKeys = Object.keys(setDatas);
        setKeys.forEach((port) => {
            const data = setDatas[port];
            // To chceck if Entry sent the block really
            // console.log(`setDatas: key=${data.type} port=${port} data=${data.data}`); 
            if (data) {
                if (self.digitalPortTimeList[port] < data.time) {
                    self.digitalPortTimeList[port] = data.time;

                    if (!self.isRecentData(port, data.type, data.data)) {
                        self.recentCheckData[port] = {
                            type: data.type,
                            data: data.data,
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
        console.log('sendBuf= ', this.sendBuffers);
    }
};

// 엔트리 블록 중복전송 방지: 최초 1회 Get으로 요청하면, 계속 구독중 되므로 중복 재전송 불필요
Module.prototype.isRecentData = function(port, type, data) {
    const that = this;
    let isRecent = false;

    if (type == this.sensorTypes.ULTRASONIC) {
        const portString = port.toString();
        let isGarbageClear = false;
        Object.keys(this.recentCheckData).forEach((key) => {
            const  recent = that.recentCheckData[key];
            if (key === portString) {
                
            }
            if (key !== portString && 
                (recent.type == that.sensorTypes.ULTRASONIC)) {
                delete that.recentCheckData[key];
                isGarbageClear = true;
            }
        });

        if ((port in this.recentCheckData && isGarbageClear) || 
            !(port in this.recentCheckData) ||
            this.isNewConn) {
            isRecent = false;
            this.isNewConn = false; // Re-subscribe when hw is connected newly
        } else {
            isRecent = true;
        }
    } else if (port in this.recentCheckData && type != this.sensorTypes.TONE) {
        if (
            this.recentCheckData[port].type === type &&
            this.recentCheckData[port].data === data
        ) {
            isRecent = true;
        }
    }
    
    return isRecent;
};

/*
    엔트리에서 받아 처리된 데이터 -> 하드웨어로 전달
    slave 모드인 경우 duration 속성 간격으로 지속적으로 기기에 요청을 보냅니다.
    master 모드인 경우 하드웨어로부터 데이터 받자마자 바로 송신한다.
*/
Module.prototype.requestLocalData = function() {
    const self = this;

    if (!this.isDraing && this.sendBuffers.length > 0) {
        this.isDraing = true;
        this.sp.write(this.sendBuffers.shift(), () => {
            if (self.sp) {
                self.sp.drain(() => {
                    self.isDraing = false;
                });
            }
        });
    }

    return null;
};

Module.prototype.initProperties = function(obj) {
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
Module.prototype.handleLocalData = function(data) {
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
                self.sensorData.DIGITAL[port] = value;
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
                self.sensorData.IRREMOTE[port] = value;
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
Module.prototype.makeSensorReadBuffer = function(device, port, data) {
    let buffer;
    const value = new Buffer(2);
    const dummy = new Buffer([10]); // 10Bytes
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
            break;
        case this.sensorTypes.DHTTEMP:
        case this.sensorTypes.DHTHUMI:
        case this.sensorTypes.IRREMOTE:
        case this.sensorTypes.ANALOG: // AnalogRead
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
            break;
        default:
            value.writeInt16LE(data); // 2Bytes
            buffer = new Buffer([
                255,
                85,
                7,
                sensorIdx,
                this.actionTypes.GET,
                device,
                port,
                10, 
            ]);
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
Module.prototype.makeOutputBuffer = function(device, port, data) {
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
            break;
        }
    }

    console.log('SetCmdBuf=', buffer);
    return buffer;
};

Module.prototype.getDataByBuffer = function(buffer) {
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

Module.prototype.disconnect = function(connect) {
    const self = this;
    connect.close();
    if (self.sp) {
        delete self.sp;
    }
};

Module.prototype.reset = function() {
    this.lastTime = 0;
    this.lastSendTime = 0;

    this.sensorData.PULSEIN = {};
};

Module.prototype.lostController = function(connector, stateCallback) {
    // 아무일도 안하지만, 해당 함수가 선언되면 하드웨어에서 시간 내 응답없으면 연결 종료시키는 lostTimer가 선언되지 않음
};

module.exports = new Module();

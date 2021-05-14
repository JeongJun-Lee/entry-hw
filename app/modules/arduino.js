function Module() {
    this.digitalValue = new Array(14);
    this.analogValue = new Array(6);

    this.remoteDigitalValue = new Array(14);
    this.readablePorts = null;
    this.remainValue = null;
}

Module.prototype.init = function(handler, config) {};

Module.prototype.requestInitialData = function() {
    return null;
};

Module.prototype.checkInitialData = function(data, config) {
    return true;
};

// 주기적으로 하드웨어에서 받은 데이터의 검증이 필요한 경우 사용
Module.prototype.validateLocalData = function(data) {
    return true;
};

// 엔트리에서 받은 데이터에 대한 처리
Module.prototype.handleRemoteData = function(handler) {
    this.readablePorts = handler.read('readablePorts');
    var digitalValue = this.remoteDigitalValue;
    for (var port = 0; port < 14; port++) {
        digitalValue[port] = handler.read(port);
    }
};

/*
  엔트리에서 받은 데이터 처리된 내용을 하드웨어로 전달
  slave 모드인 경우 duration 속성 간격으로 지속적으로 기기에 요청을 보내고,
  master 모드인 경우 하드웨어로부터 데이터 받자마자 바로 송신한다.
*/
Module.prototype.requestLocalData = function() {
    var queryString = [];

    var readablePorts = this.readablePorts;
    if (readablePorts) {
        for (var i in readablePorts) {
            var query = (5 << 5) + (readablePorts[i] << 1);
            queryString.push(query);
        }
    }
    var readablePortsValues =
        (readablePorts && Object.values(readablePorts)) || [];
    var digitalValue = this.remoteDigitalValue;
    for (var port = 0; port < 14; port++) {
        if (readablePortsValues.indexOf(port) > -1) {
            continue;
        }
        var value = digitalValue[port];
        if (value === 255 || value === 0) {
            var query = (7 << 5) + (port << 1) + (value == 255 ? 1 : 0);
            queryString.push(query);
        } else if (value > 0 && value < 255) {
            var query = (6 << 5) + (port << 1) + (value >> 7);
            queryString.push(query);
            query = value & 127;
            queryString.push(query);
        }
    }
    return queryString;
};

// 하드웨어에서 온 데이터 처리
Module.prototype.handleLocalData = function(data) {
    // data: Native Buffer
    var pointer = 0;
    for (var i = 0; i < 32; i++) {
        var chunk;
        if (!this.remainValue) {
            chunk = data[i];
        } else {
            chunk = this.remainValue;
            i--;
        }
        if (chunk >> 7) {
            if ((chunk >> 6) & 1) {
                var nextChunk = data[i + 1];
                if (!nextChunk && nextChunk !== 0) {
                    this.remainValue = chunk;
                } else {
                    this.remainValue = null;

                    var port = (chunk >> 3) & 7;
                    this.analogValue[port] =
                        ((chunk & 7) << 7) + (nextChunk & 127);
                }
                i++;
            } else {
                var port = (chunk >> 2) & 15;
                this.digitalValue[port] = chunk & 1;
            }
        }
    }
};

// 하드웨어에서 온 데이터 처리된 내용을 엔트리로 전달
Module.prototype.requestRemoteData = function(handler) {
    for (var i = 0; i < this.analogValue.length; i++) {
        var value = this.analogValue[i];
        handler.write('a' + i, value);
    }
    for (var i = 0; i < this.digitalValue.length; i++) {
        var value = this.digitalValue[i];
        handler.write(i, value);
    }
};

Module.prototype.reset = function() {};

module.exports = new Module();

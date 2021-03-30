const BaseModule = require('./baseModule');

const CurrMode = {
  ENTRY_MODE: 0,
  UPLOAD_MODE: 1
};

class Neobot extends BaseModule {
  // 클래스 내부에서 사용될 필드들을 이곳에서 선언합니다.
  constructor() {
    super();

    this.LOCAL_MAP = [
      'IN1',
      'IN2',
      'IN3',
      'IR',
      'BAT'
    ];

    this.REMOTE_MAP = [
      'OUT1',
      'OUT2',
      'OUT3',
      'DCL',
      'DCR',
      'SND',
      'FND',
      'OPT'
    ];

    this.currMode = CurrMode.ENTRY_MODE;

    // 하드웨어용
    this.hwSendBuf = []; // 하드웨어로 전송
    this.hwRecvBuf = []; // 하드웨어에서 수신
    this.hwVerfBuf = [];
    this.needAckChk = false; // 하드웨어로부터 Ack 확인필요여부
    this.dataFrame = null;

    // 엔트리용, Init by undefined
    this.etSendBuf = new Array(this.LOCAL_MAP.length);  // 엔트리로 전송
    this.etRecvBuf = new Array(this.REMOTE_MAP.length); // 엔트리에서 수신
  }
	
  /*
  최초에 커넥션이 이루어진 후의 초기 설정.
  handler 는 워크스페이스와 통신하 데이터를 json화 하는 오브젝트입니다. (datahandler/json 참고)
  config 은 module.json 오브젝트입니다.
  */
  init(handler, config) {
    this.handler = handler;
		this.config = config;

    // init
    this.currMode = CurrMode.ENTRY_MODE;
    this.needAckChk = false;
    this.dataFrame = null;
    this.hwSendBuf.length = 0;
  }

  lostController(connector, stateCallback) {
    // 아무일도 안하지만, 해당 함수가 선언되면 하드웨어에서 시간 내 응답없으면 연결 종료시키는 lostTimer가 선언되지 않음
  }

  /*
  연결 후 초기에 송신할 데이터가 필요한 경우 사용합니다.
  requestInitialData 를 사용한 경우 checkInitialData 가 필수입니다.
  이 두 함수가 정의되어있어야 로직이 동작합니다. 필요없으면 작성하지 않아도 됩니다.
  */
  requestInitialData() {
    return true;
  }

  // 연결 후 초기에 수신받아서 정상연결인지를 확인해야하는 경우 사용합니다.
  checkInitialData(data, config) {
    return true;
  }

  // 주기적으로 하드웨어에서 받은 데이터의 검증이 필요한 경우 사용합니다.
  validateLocalData(data) { 
    return this.checkCheckSum(data) ? true :  console.log('validateLocalData fail!');
  }

  // 하드웨어에서 온 데이터 처리
  handleLocalData(revFrame) {
    this.hwRecvBuf = revFrame;
    console.log('hwRecvBuf=', this.hwRecvBuf);

    // Handle sensing data in Entry Mode
    if (this.currMode === CurrMode.ENTRY_MODE) {
      this.initArr(this.etSendBuf);
      for (var i = 0; i < this.hwRecvBuf.length - 1; i++) {
        if (this.hwRecvBuf[i] === 0xAB && this.hwRecvBuf[i + 1] === 0xCD) { // Check header
          // Except header and checksum
          this.hwRecvBuf.slice(i + 2, i + 7).forEach((value, idx) => {
            this.etSendBuf[idx] = value;
          });
          break;
        }
      }
    }

    // Handle ACK in App Mode
    if (this.needAckChk && new Uint8Array(revFrame, 0, 6).toString() === this.createConnAckFrame().toString()) { 
      console.log('Ack arrived from HW, CurrMode is UPLOAD_MODE');
      this.currMode = CurrMode.UPLOAD_MODE;
      this.needAckChk = false;

    } else if (this.needAckChk && new Uint8Array(revFrame, 0, 6).toString() === this.createDataAckFrame().toString()) {
      console.log('Ack arrived from HW, Cmd is Success!');
      this.hwSendBuf.length = 0; // init
      this.needAckChk = false;
    }

    // NACK handling in App Mode
    if (
      this.needAckChk && 
      (new Uint8Array(revFrame, 0, 6).toString() === this.createConnNackFrame().toString() ||
       new Uint8Array(revFrame, 0, 6).toString() === this.createDataNackFrame().toString()) 
    ) {
      console.log('Nack arrived from HW, Cmd is fail!');
      this.hwSendBuf.length = 0; // init
      this.needAckChk = false;
    }
  }
   
  // 하드웨어로부터 와서 처리된 데이터 -> 엔트리로 전달
  // 밑단에서 먼저 handleLocalData() 호출 후 다음 순차적으로 이를 호출
  requestRemoteData(handler) {
    // Handle sensing data in Entry Mode
    if (this.currMode === CurrMode.ENTRY_MODE) {
      this.LOCAL_MAP.forEach((val, idx) => {
        handler.write(val, this.etSendBuf[idx]);
      });
      this.initArr(this.etSendBuf);
    }
  }

  // 엔트리에서 받은 데이터에 대한 처리
  handleRemoteData(handler) {  
    this.dataFrame = handler.read('frame');

    // Cmd data handling in Entry Mode
    if (this.currMode === CurrMode.ENTRY_MODE && !this.dataFrame) { 
      this.initArr(this.etRecvBuf);
      this.REMOTE_MAP.forEach(function(key, idx) {
        this.etRecvBuf[idx] = handler.read(key);
      }.bind(this));
    }
  }

  /*
  엔트리에서 받아 처리된 데이터 -> 하드웨어로 전달
  slave 모드인 경우 duration 속성 간격으로 지속적으로 기기에 요청을 보냅니다.
  master 모드인 경우 하드웨어로부터 데이터 받자마자 바로 송신한다.
  따라서, Entry mode의 경우, 계속 하드웨어서 센서 데이터를 보내기 때문에 결국 이 함수는 밑단에서 계속 반복 호출하나,
  Upload mode의 경우, 하드웨어에서 센서 데이터를 보내지 않기 때문에 이 함수가 밑단에서 호출될 다른 방법을 강구해야 하며,
  현재 통신모드를 slave로 설정해 대응하고 있으나, 추후 다른 방법의 고민이 필요함!
  */
  requestLocalData() {
    // Handle cmd data in Entry Mode
    if (this.currMode === CurrMode.ENTRY_MODE && !this.isEmptyArr(this.etRecvBuf)) { 
      // 시작 바이트
      this.hwSendBuf.length = 0; // init
      this.hwSendBuf.push(0xCD);
      this.hwSendBuf.push(0xAB);

      var checksum = 0;
      var isFnd = false;
      this.etRecvBuf.forEach(function(value, idx) {
        if (idx === 6 && value > 0) {
          isFnd = true;
        } else if (idx === 7 && isFnd) {
          value = value | 8;
        }
        this.hwSendBuf.push(value);
        checksum += value;
      }.bind(this));

      //체크썸
      checksum = checksum & 255;
      this.hwSendBuf.push(checksum);

      this.initArr(this.etRecvBuf);

    } else if (this.currMode === CurrMode.ENTRY_MODE && this.isEmptyArr(this.etRecvBuf)) {
      this.hwSendBuf.length = 0; // If nothing to send, clear sending buffer
    } 
    
    if (
      this.currMode === CurrMode.ENTRY_MODE && 
      this.dataFrame &&
      !this.needAckChk // Until receiving Ack, don't resend mode-change-frame
    ) {
      // Switch to App protocol mode at first
      this.createModeChangeFrame(); 
      
    } else if (this.currMode === CurrMode.UPLOAD_MODE && this.dataFrame) {
      // Send data frame since mode is changed
      this.hwSendBuf = this.dataFrame.slice(); // deep copy
      this.dataFrame.length = 0; // init
      this.needAckChk = true;
    }

    console.log('hwSendBuf= ', this.hwSendBuf); 
    return this.isEmptyArr(this.hwSendBuf) ? false : this.hwSendBuf;
  }

  checkCheckSum(data) {
    let frameLen = 0;
    let headerLen = 0;
    let headerCheckFunc = 0;

    if (!this.needAckChk && this.currMode === CurrMode.ENTRY_MODE)  {
      frameLen = 8;
      headerLen = 2;
      headerCheckFunc = this.hasEntryHeader(data);
    } else { 
      frameLen = 6; // For Ack/Nack
      headerLen = 3;
      headerCheckFunc = this.hasHeader(data);
    }

    var state = false;
    for (var i = 0; i < data.length - 1; i++) {
      if (headerCheckFunc) {
        var dataSet = data.slice(i, i + frameLen);
        var dataSum = dataSet.reduce(function (result, value, idx) {
          if (idx < headerLen || idx >= dataSet.length-1) {
            return result;
          }
          return result + value;
        }, 0);
        if ((dataSum & 255) === dataSet[dataSet.length-1]) {
          state = true;
        }
        break;
      }
    }
    return state;      

    
    // else { // UPLOAD_MODE or First mode change
      // Skip temporarily
      // data.forEach((data, idx) => {
      //   if (this.hasHeader(data)) {
      //     let dataSet = data.slice(idx, idx + 5); // Frame length is 5

      //   }
      // });
    //   return true;
    // }
  }

  initArr(arr) {
    return arr.fill(); // Init by undefined
  }

  isEmptyArr(arr) {
    return arr.includes(undefined) || !arr.length;
  }

  hasEntryHeader(frame) {
    return (frame[0] === 0xAB && frame[1] === 0xCD) ? true : false;
  }

  hasHeader(frame) {
    return (frame[0] === 0xAA && frame[1] === 0xAA && frame[2] === 0xBB) ? true : false;
  }

  addSendHeader(buffer) {
    // 송신 프레임 헤더
    buffer.push(0xAA);
    buffer.push(0xAA);
    buffer.push(0xAA);
  }

  createCheckSum(frame) {
    var checksum = 0;

    // DataType + Data 를 모두 더한 값 하위 1Byte
    if (frame[3] !== 0x02) { // If not Data frame, payload size is 2bytes
      checksum = (frame[3] + frame[4]) & 0xFF;
    } else { 
      // Strip header and accumulate to the end
      checksum = frame.slice(3).reduce((prev, curr) => prev + curr, 0, 3) & 0xFF;
    }

    return checksum;
  }
  
  addCheckSum(buffer) {
    buffer.push(this.createCheckSum(buffer));
  }

  createModeChangeFrame() {
    this.hwSendBuf.length = 0; // init

    this.addSendHeader(this.hwSendBuf);
    this.hwSendBuf.push(0x01); // Data type
    this.hwSendBuf.push(0x04); // Data
    this.addCheckSum(this.hwSendBuf);

    this.needAckChk = true;
  }

  createDataStartFrame() {
    this.hwSendBuf.length = 0; // init

    this.addSendHeader(this.hwSendBuf);
    this.hwSendBuf.push(0x01); // Data type
    this.hwSendBuf.push(0x01); // Data
    this.addCheckSum(this.hwSendBuf);
  }

  createDataExitFrame() {
    this.addSendHeader(this.hwSendBuf);
    this.hwSendBuf.push(0x01); // Data type
    this.hwSendBuf.push(0x02); // Data
    this.addCheckSum(this.hwSendBuf);

    this.needAckChk = true;
  }

  addRecvHeader(buffer) {
    // 수신 프레임 헤더
    buffer.push(0xAA);
    buffer.push(0xAA);
    buffer.push(0xBB);
  }

  createConnAckFrame() {
    this.hwVerfBuf.length = 0; // init

    this.addRecvHeader(this.hwVerfBuf);
    this.hwVerfBuf.push(0x03); // Data type
    this.hwVerfBuf.push(0x03); // Data
    this.addCheckSum(this.hwVerfBuf);

    return this.hwVerfBuf;
  }

  createConnNackFrame() {
    this.hwVerfBuf.length = 0; // init

    this.addRecvHeader(this.hwVerfBuf);
    this.hwVerfBuf.push(0x03); // Data type
    this.hwVerfBuf.push(0x02); // Data
    this.addCheckSum(this.hwVerfBuf);

    return this.hwVerfBuf;
  }

  createDataAckFrame() {
    this.hwVerfBuf.length = 0; // init

    this.addRecvHeader(this.hwVerfBuf);
    this.hwVerfBuf.push(0x03); // Data type
    this.hwVerfBuf.push(0x01); // Data
    this.addCheckSum(this.hwVerfBuf);

    return this.hwVerfBuf;
  }

  createDataNackFrame() {
    this.hwVerfBuf.length = 0; // init

    this.addRecvHeader(this.hwVerfBuf);
    this.hwVerfBuf.push(0x03); // Data type
    this.hwVerfBuf.push(0x00); // Data
    this.addCheckSum(this.hwVerfBuf);

    return this.hwVerfBuf;
  }
}

module.exports = new Neobot();
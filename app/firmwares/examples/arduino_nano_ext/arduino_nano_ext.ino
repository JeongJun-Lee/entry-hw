/**********************************************************************************
 * The following software may be included in this software : orion_firmware.ino
 * from http://www.makeblock.cc/
 * This software contains the following license and notice below:
 * CC-BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)
 * Author : Ander, Mark Yan
 * Updated : Ander, Mark Yan, JJ Lee
 * Updated : 12/19/2021
 * Description : Firmware for Makeblock Electronic modules with Scratch.
 * Copyright (C) 2013 - 2016 Maker Works Technology Co., Ltd. All right
 *reserved. Copyright (C) 2021 - Roboticsware Co., Ltd. All right reserved about
 *the updated parts.
 **********************************************************************************/

#include <DHT.h>
#include <IRremote.h>
#include <LCDI2C_Multilingual.h>
#include <Servo.h>
#include <Stepper.h>
#include <Wire.h>

// sensorTypes
#define S_RESET 255
#define ALIVE 0
#define DIGITAL 1
#define ANALOG 2
#define PWM 3
#define SERVO_PIN 4
#define TONE 5
#define PULSEIN 6
#define ULTRASONIC 7
#define TIMER 8
#define STEPPER 9
#define DHTINIT 10   // a
#define DHTTEMP 11   // b
#define DHTHUMI 12   // c
#define IRRINIT 13   // d
#define IRREMOTE 14  // e
#define LCD_INIT 15  // f
#define LCD_PRINT 16 // 10
#define LCD_CLEAR 17 // 11
#define MPU 18       // 12
#define MOTOR 19     // 13
#define SOUND 20     // 14

// actionsTypes
#define GET 1
#define SET 2
#define RESET 3

// val Union
union {
  byte byteVal[4];
  float floatVal;
  long longVal;
} val;

// valShort Union
union {
  byte byteVal[2];
  short shortVal;
} valShort;

// 전역변수 선언 시작
Servo servos[8]; // 아두이노 최대 연결가능 서보모터 수
// int motorSpeeds[2] = {0, 0};

// 울트라 소닉
int trigPin = -1;
int echoPin = -1;

// 온습도
DHT *dhtObj = NULL;
int dhtPin = -1;
boolean isDhtTemp = false; // true이 되면 값을 read해서 엔트리로 전송
boolean isDhtHumi = false;

// IRremote
decode_results results; // decoded result for IRRmote
IRrecv *irrObj = NULL;
int irrPin = -1;
boolean isIrremote = false;
boolean isMpu = false;
#define MPU_ADDR 0x68

// 포트별 상태: 1이 되면 값을 read해서 엔트리로 전송
int digitals[14] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
int servo_pins[8] = {0, 0, 0, 0, 0, 0, 0, 0};

// 버퍼
char buffer[52];
unsigned char prevc = 0;

byte index = 0;
byte dataLen;

double lastTime = 0.0;
double currentTime = 0.0;

uint8_t command_index = 0;
boolean isStart = false;

// LCD
LCDI2C_RussianLatin *lcdObj = NULL;

byte findI2CAddress() {
  byte error, address = 0, foundAddress;

  for (address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();

    if (error == 0) {
      foundAddress = address;
    }
  }
  return foundAddress;
}

void setup() {
  Wire.begin(); // For finding I2C addr for LCD
  Serial.begin(115200);
  Serial.flush();
  delay(200);

  // 아두이노는 기본적으로 전원인가 후 내장LED가 켜지므로 초기값은 끈 상태로
  // 유지
  pinMode(13, OUTPUT);
  digitalWrite(13, LOW);

  // 아우디노 나노는 디지털 8번핀(조이스틱 버튼)을 상시 모니터링합니다.

  // 디지털 포트 모니터링 On JoyBtn
  digitals[8] = 1;

  // MPU6050 초기화 (상시 모니터링 위해)
  Wire.begin();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1 register
  Wire.write(0);    // Wake up
  if (Wire.endTransmission(true) == 0) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1A); // CONFIG register
    Wire.write(0x03); // DLPF 44Hz
    Wire.endTransmission(true);
    isMpu = true;
  }
}

void loop() {
  while (Serial.available()) { // 수신 데이터 파싱
    if (Serial.available() > 0) {
      char serialRead = Serial.read();
      setPinValue(serialRead & 0xff);
    }
  }
  sendPinValues(); // 포트 상태값 포함한 요청값 회신
}

/*
ff 55 len idx action device port (tailer) (value) (dummy)
0  1  2   3   4      5      6    a        7       10Bytes
len은 idx~데이터 까지의 길이
tailer는 HW에서 송신시 Serial.println()에 의한 LF값(10)
*/
void setPinValue(unsigned char c) {
  if (c == 0x55 && isStart == false) {
    if (prevc == 0xff) { // 0xFF 0x55 헤더 확인
      index = 1;
      isStart = true;
    }
  } else {
    prevc = c;
    if (isStart) {
      if (index == 2) {
        dataLen = c;
      } else if (index > 2) {
        dataLen--;
      }

      writeBuffer(index, c);
    }
  }

  index++;

  if (index > 51) { // 50Bytes 크기 버퍼
    index = 0;
    isStart = false;
  }

  if (isStart && dataLen == 0 && index > 3) {
    isStart = false;
    parseData();
    index = 0;
  }
}

unsigned char readBuffer(int index) { return buffer[index]; }

void parseData() {
  isStart = false;
  int idx = readBuffer(3);
  command_index = (uint8_t)idx;
  int action = readBuffer(4);
  int device = readBuffer(5);
  int port = readBuffer(6);

  switch (action) {
  case GET: { // 매번 엔트리에서 요청하는 방식이 아닌, 하드웨어가 값을 계속
              // 보내올 것(구독)을 1회성 요청하는 방식
    if (device == ULTRASONIC) {
      trigPin = readBuffer(6);
      echoPin = readBuffer(7);
      digitals[trigPin] = 0; // Report Off
      digitals[echoPin] = 0; // Report Off
      sendUltrasonic();
    } else if (device == DHTTEMP) { // DHTINIT에 의해 초기화를 별도로 수행
      isDhtTemp = true;
    } else if (device == DHTHUMI) {
      isDhtHumi = true;
    } else if (device == IRREMOTE) {
      isIrremote = true;
    } else if (device == MPU) {
      if (!isMpu) {
        Wire.begin(); // Ensure Wire is started
        Wire.beginTransmission(MPU_ADDR);
        Wire.write(0x6B); // PWR_MGMT_1 register
        Wire.write(0);    // Wake up
        if (Wire.endTransmission(true) == 0) {
          // Set DLPF (Digital Low Pass Filter) to 44Hz (3) or 21Hz (4)
          Wire.beginTransmission(MPU_ADDR);
          Wire.write(0x1A); // CONFIG register
          Wire.write(0x03); // 44Hz
          Wire.endTransmission(true);
          isMpu = true;
        }
      }
    } else if (device == DIGITAL) {
      // 신규 요청이 기 사용중(구독중)인 포트와 겹치면 기존 것은 중지
      if (port == dhtPin) {
        isDhtTemp = false;
        isDhtHumi = false;
      } else if (port == irrPin) {
        isIrremote = false;
      }
      digitals[port] = 1;
    } else if (device == ANALOG) {
      sendAnalogValue(port);
    } else if (device == SOUND) {
      sendSoundValue(port);
    }
  } break;
  case SET: { // 매번 엔트리에서 값을 set하는 방식
    runModule(device);
    // callOK();
  } break;
  case RESET: { // 엔트리와 연결시 마다 초기화 수행
    for (int pinNumber = 0; pinNumber < (sizeof(digitals) / sizeof(int));
         pinNumber++) {
      digitals[pinNumber] = 0;
    }
    // 상시 모니터링 포트 재설정
    digitals[8] = 1; // JoyBtn 상시 모니터링 유지
    // 아날로그/사운드 포트는 상시 모니터링 안함 (GET 요청시에만 응답)
    isDhtTemp = false;
    isDhtHumi = false;
    isIrremote = false;
    isMpu = true; // MPU 상시 모니터링 유지
    callResetOK();
  } break;
  }
}

void runModule(int device) {
  int port = readBuffer(6);
  int pin = port;

  switch (device) {
  case DIGITAL: {
    setPortWritable(pin);
    int v = readBuffer(7);
    digitalWrite(pin, v);
  } break;
  case PWM: {
    setPortWritable(pin);
    int v = readBuffer(7);
    analogWrite(pin, v);
  } break;
  case TONE: {
    setPortWritable(pin);
    int hz = readShort(7);
    int ms = readShort(9);
    if (ms > 0) {
      tone(pin, hz, ms);
    } else {
      noTone(pin);
    }
  } break;
  case SERVO_PIN: {
    setPortWritable(pin);
    int v = readBuffer(7);
    if (v >= 0 && v <= 180) { // 서모모터 SG-90으로 가정해 180까지
      Servo sv = servos[searchServoPin(pin)];
      sv.attach(pin, 500, 2500);
      sv.write(v);
    }
  } break;
  case TIMER: {
    lastTime = millis() / 1000.0;
  } break;
  case STEPPER: {
    int p1 = readBuffer(7);
    int p2 = readBuffer(9);
    int p3 = readBuffer(11);
    int p4 = readBuffer(13);
    int sp = readBuffer(15);
    int s = readShort(17);
    if (s >= -2048 && s <= 2048) { // 값이 최대 2048이므
      Stepper st(2048, p1, p2, p3, p4);
      st.setSpeed(sp);
      st.step(s);
    }
  } break;
  case DHTINIT: {
    if (!dhtObj || (dhtPin != pin)) { // 포트변경시 새 객체 생성
      if (dhtObj)
        delete dhtObj;
      dhtObj = new DHT(pin, DHT11);
      dhtObj->begin();
    }
    dhtPin = pin;
    digitals[pin] = 0; // Report Off
  } break;
  case IRRINIT: {
    if (!irrObj || (irrPin != pin)) { // 포트변경시 새 객체 생성
      if (irrObj)
        delete irrObj;
      irrObj = new IRrecv(pin);
      irrObj->enableIRIn();
    }
    irrPin = pin;
    digitals[pin] = 0; // Report Off
  } break;
  case LCD_INIT: {
    if (lcdObj)
      delete lcdObj;
    // set the I2C address(0x27) with a 16 chars and 2 line of 1602* LCD display
    lcdObj = new LCDI2C_RussianLatin(findI2CAddress(), 16, 2);
    lcdObj->init();
    lcdObj->backlight();
    lcdObj->clear();
  } break;
  case MOTOR: {
    int v = readShort(7); // low: speed, high: dir
    int speed = v & 0xff;
    int dir = (v >> 8) & 0x01; // 0: fw, 1: bw

    int p1, p2;
    if (port == 1) {
      p1 = 5;
      p2 = 9;
    } else {
      p1 = 6;
      p2 = 10;
    }

    pinMode(p1, OUTPUT);
    pinMode(p2, OUTPUT);

    if (dir == 0) { // Forward
      analogWrite(p1, speed);
      analogWrite(p2, 0);
    } else { // Backward
      analogWrite(p1, 0);
      analogWrite(p2, speed);
    }
    // motorSpeeds[port - 1] = (dir == 0) ? speed : -speed;
  } break;
  case LCD_PRINT: {
    int row = readBuffer(7);
    int col = readBuffer(8);
    int len = readBuffer(9);
    if (lcdObj) {
      if (len == 0) {
        lcdObj->clear();
      } else {
        String txt = readString(len, 10);
        lcdObj->setCursor(col, row);
        lcdObj->print(txt);
      }
    }
  } break;
  case LCD_CLEAR: {
    if (lcdObj)
      lcdObj->clear();
  } break;
  }
}

// For port monitoring in Entry
void sendPinValues() {
  static unsigned long lastSendTime = 0;
  if (millis() - lastSendTime < 20) return; // 50Hz Rate Limit (Non-blocking)
  lastSendTime = millis();
  for (int pinNumber = 0; pinNumber < (sizeof(digitals) / sizeof(int));
       pinNumber++) {
    if (digitals[pinNumber] == 1) {
      sendDigitalValue(pinNumber);
      // callOK();
    }
  }
  // 사운드/아날로그 센서는 parseData에서 실시간 응답하므로 루프 제거됨
  // 초음파 센서는 parseData에서 실시간 응답하므로 루프 제거됨

  if (isDhtTemp) {
    sendDhtTempValue();
    // callOK();
  }

  if (isDhtHumi) {
    sendDhtHumiValue();
    // callOK();
  }

  if (isIrremote) {
    sendIrrecvValue();
    // callOK();
  }

  if (isMpu) {
    sendMpuValue();
  }
}
//   // Motor Speed Reporting (Using MOTOR type as a sensor feedback)
//   reportMotorSpeed(1); // M1
//   reportMotorSpeed(2); // M2
// }

// void reportMotorSpeed(int port) {
//   writeHead();
//   sendShort(motorSpeeds[port - 1]);
//   writeSerial(port - 1); // port 0, 1
//   writeSerial(MOTOR);
//   writeEnd();
// }

float mpuYaw = 0;
unsigned long lastMpuTime = 0;

void sendMpuValue() {
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) {
    // Communication error, try to wake up again
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x6B);
    Wire.write(0);
    Wire.endTransmission();
    return; 
  }

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(true);
  Wire.requestFrom(MPU_ADDR, 14);

  if (Wire.available() >= 14) {
    int16_t ax = Wire.read() << 8 | Wire.read();
    int16_t ay = Wire.read() << 8 | Wire.read();
    int16_t az = Wire.read() << 8 | Wire.read();
    int16_t tmp = Wire.read() << 8 | Wire.read();
    int16_t gx = Wire.read() << 8 | Wire.read();
    int16_t gy = Wire.read() << 8 | Wire.read();
    int16_t gz = Wire.read() << 8 | Wire.read();

    float roll = atan2((float)ay, (float)az) * 57.29578;
    float pitch = atan2(-(float)ax, sqrt((float)ay * ay + (float)az * az)) * 57.29578;
    // float temperature = (tmp / 340.0) + 36.53; // Internal chip temperature

    unsigned long now = millis();
    if (lastMpuTime > 0) {
      float dt = (now - lastMpuTime) / 1000.0;
      if (dt > 0 && dt < 0.2) { // Sanity check for dt
        mpuYaw += (gz / 131.0) * dt;
      }
    }
    lastMpuTime = now;

    if (roll < 0) roll += 360.0;
    if (pitch < 0) pitch += 360.0;
    float yaw = fmod(mpuYaw, 360.0);
    if (yaw < 0) yaw += 360.0;

    int16_t values[] = {ax, ay, az, gx, gy, gz, (int16_t)roll, (int16_t)pitch, (int16_t)yaw};
    for (int i = 0; i < 9; i++) {
      writeHead();
      sendShort(values[i]);
      writeSerial(i);
      writeSerial(MPU);
      writeEnd();
    }
  }
}

void sendUltrasonic() {
  if (trigPin == echoPin) {
    pinMode(trigPin, OUTPUT);
  }
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  if (trigPin == echoPin) {
    pinMode(echoPin, INPUT);
  }
  float value = pulseIn(echoPin, HIGH, 30000) / 29.0 / 2.0;

  writeHead();
  sendFloat(value);
  writeSerial(trigPin);
  writeSerial(echoPin);
  writeSerial(ULTRASONIC);
  writeEnd();
}

void sendDhtTempValue() {
  int value = 0;
  if (dhtObj) {
    value = dhtObj->readTemperature();
  }

  writeHead();
  sendShort(value);
  writeSerial(dhtPin);
  writeSerial(DHTTEMP);
  writeEnd();
}

void sendDhtHumiValue() {
  int value = 0;
  if (dhtObj) {
    value = dhtObj->readHumidity();
  }

  writeHead();
  sendShort(value);
  writeSerial(dhtPin);
  writeSerial(DHTHUMI);
  writeEnd();
}

void sendIrrecvValue() {
  int value = -1;
  if (irrObj) {
    if (irrObj->decode(&results)) {
      switch (results.value) {
      case 0xFF6897:
        value = 0;
        break;
      case 0xFF30CF:
        value = 1;
        break;
      case 0xFF18E7:
        value = 2;
        break;
      case 0xFF7A85:
        value = 3;
        break;
      case 0xFF10EF:
        value = 4;
        break;
      case 0xFF38C7:
        value = 5;
        break;
      case 0xFF5AA5:
        value = 6;
        break;
      case 0xFF42BD:
        value = 7;
        break;
      case 0xFF4AB5:
        value = 8;
        break;
      case 0xFF52AD:
        value = 9;
        break;
      default:
        value = 10;
        break;
      }
      irrObj->resume();
    }
  }

  writeHead();
  sendShort(value);
  writeSerial(irrPin);
  writeSerial(IRREMOTE);
  writeEnd();
}

void sendDigitalValue(int pinNumber) {
  pinMode(pinNumber, INPUT);
  writeHead();
  sendFloat(digitalRead(pinNumber));
  writeSerial(pinNumber);
  writeSerial(DIGITAL);
  writeEnd();
}

void sendAnalogValue(int pinNumber) {
  writeHead();
  sendFloat(analogRead(pinNumber));
  writeSerial(pinNumber);
  writeSerial(ANALOG);
  writeEnd();
}

void sendSoundValue(int pin) {
  unsigned long startMillis = millis();
  unsigned int signalMax = 0;
  unsigned int signalMin = 1024;
  while (millis() - startMillis < 50) {
    int sample = analogRead(pin);
    if (sample < 1024) {
      if (sample > signalMax)
        signalMax = sample;
      else if (sample < signalMin)
        signalMin = sample;
    }
  }
  int value = signalMax - signalMin;

  writeHead();
  sendShort(value);
  writeSerial(pin);
  writeSerial(SOUND);
  writeEnd();
}

void writeBuffer(int index, unsigned char c) { buffer[index] = c; }

void writeHead() {
  writeSerial(0xff);
  writeSerial(0x55);
}

void writeEnd() {
  Serial.println(); // CR(0x0D 0x0A) is added at the end of the packet by
                    // println()
}

void writeSerial(unsigned char c) { Serial.write(c); }

void sendString(String s) {
  int l = s.length();
  writeSerial(4);
  writeSerial(l);
  for (int i = 0; i < l; i++) {
    writeSerial(s.charAt(i));
  }
}

void sendFloat(float value) {
  writeSerial(2);
  val.floatVal = value;
  writeSerial(val.byteVal[0]);
  writeSerial(val.byteVal[1]);
  writeSerial(val.byteVal[2]);
  writeSerial(val.byteVal[3]);
}

void sendShort(double value) {
  writeSerial(3);
  valShort.shortVal = value;
  writeSerial(valShort.byteVal[0]);
  writeSerial(valShort.byteVal[1]);
}

short readShort(int idx) {
  valShort.byteVal[0] = readBuffer(idx);
  valShort.byteVal[1] = readBuffer(idx + 1);
  return valShort.shortVal;
}

float readFloat(int idx) {
  val.byteVal[0] = readBuffer(idx);
  val.byteVal[1] = readBuffer(idx + 1);
  val.byteVal[2] = readBuffer(idx + 2);
  val.byteVal[3] = readBuffer(idx + 3);
  return val.floatVal;
}

long readLong(int idx) {
  val.byteVal[0] = readBuffer(idx);
  val.byteVal[1] = readBuffer(idx + 1);
  val.byteVal[2] = readBuffer(idx + 2);
  val.byteVal[3] = readBuffer(idx + 3);
  return val.longVal;
}

String readString(int len, int startIdx) {
  String str = "";

  for (int i = startIdx; i < (startIdx + len); i++) {
    str += (char)readBuffer(i);
  }

  return str;
}

int searchServoPin(int pin) {
  for (int i = 0; i < (sizeof(servo_pins) / sizeof(int)); i++) {
    if (servo_pins[i] == pin) {
      return i;
    }
    if (servo_pins[i] == 0) {
      servo_pins[i] = pin;
      return i;
    }
  }
  return 0;
}

void setPortWritable(int pin) {
  if (digitals[pin] == 1) { // 리포팅 중였으면 Report Off
    digitals[pin] = 0;
  }
  pinMode(pin, OUTPUT);
}

void callResetOK() {
  writeHead();
  sendShort(0);
  writeSerial(0);
  writeSerial(S_RESET); // sensorType
  writeEnd();
}

void callOK() {
  writeHead();
  writeEnd();
}

void callDebug(char c) {
  writeHead();
  writeSerial(c);
  writeEnd();
}

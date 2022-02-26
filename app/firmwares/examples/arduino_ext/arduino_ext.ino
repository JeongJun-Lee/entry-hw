/**********************************************************************************
 * The following software may be included in this software : orion_firmware.ino
 * from http://www.makeblock.cc/
 * This software contains the following license and notice below:
 * CC-BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)
 * Author : Ander, Mark Yan
 * Updated : Ander, Mark Yan, JJ Lee
 * Date : 12/19/2021
 * Description : Firmware for Makeblock Electronic modules with Scratch.
 * Copyright (C) 2013 - 2016 Maker Works Technology Co., Ltd. All right reserved. 
 **********************************************************************************/
// 서보 라이브러리
#include <Servo.h>
// 스텝퍼 라이브러리
#include <Stepper.h>
// 온습도계 라이브러리
#include <DHT.h>

// 동작 상수
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
#define DHTTEMP 10
#define DHTHUMI 11

// 상태 상수
#define GET 1
#define SET 2
#define RESET 3

// val Union
union{
  byte byteVal[4];
  float floatVal;
  long longVal;
}val;

// valShort Union
union{
  byte byteVal[2];
  short shortVal;
}valShort;

// 전역변수 선언 시작
Servo servos[8]; // 아두이노 최대 연결가능 서보모터 수

// 울트라 소닉
int trigPin = 13;
int echoPin = 12;
boolean isUltrasonic = false;

// 온습도
DHT* dhtTempObj = NULL;
DHT* dhtHumiObj = NULL;
int dhtTempPin = -1;
int dhtHumiPin = -1;
boolean isDhtTemp = false;
boolean isDhtHumi = false;

// 포트별 상태: 1이 되면 값을 read해서 엔트리로 전송
int analogs[6]={0,0,0,0,0,0};
int digitals[14]={0,0,0,0,0,0,0,0,0,0,0,0,0,0};
int servo_pins[8]={0,0,0,0,0,0,0,0};

// 버퍼
char buffer[52];
unsigned char prevc=0;

byte index = 0;
byte dataLen;

double lastTime = 0.0;
double currentTime = 0.0;

uint8_t command_index = 0;
boolean isStart = false;

void setup(){
  Serial.begin(115200);
  Serial.flush();
  delay(200);

  // 아두이노는 기본적으로 전원인가 후 내장LED가 켜지므로 초기값은 끈 상태로 유지
  pinMode(13, OUTPUT);
  digitalWrite(13, LOW);

  // 아날로그 포트 상시 모니터링 위해 포트 On
  for (int pinNumber = 0; pinNumber < sizeof(analogs); pinNumber++) {
    analogs[pinNumber] = 1;
  }
}

void loop(){
  while (Serial.available()) { // 수신 데이터 파싱
    if (Serial.available() > 0) {
      char serialRead = Serial.read();
      setPinValue(serialRead&0xff); 
    }
  } 
  delay(15);
  sendPinValues(); // 포트 상태값 포함한 요청값 회신
  delay(10);
}

/*
ff 55 len idx action device port (slot) (data) (tailer) (dummy)
0  1  2   3   4      5      6    a      7      a        10Bytes
len은 idx~데이터 까지의 길이 
tailer는 HW에서 송신시 Serial.println()에 의한 LF값(10)
*/
void setPinValue(unsigned char c) {
  if(c==0x55&&isStart==false){
    if(prevc==0xff){ // 0xFF 0x55 헤더 확인
      index=1;
      isStart = true;
    }    
  } else {    
    prevc = c;
    if(isStart) {
      if(index==2){
        dataLen = c; 
      } else if(index>2) {
        dataLen--;
      }
      
      writeBuffer(index,c);
    }
  }
    
  index++;
  
  if(index>51) { // 50Bytes 까지 읽고 초기화?
    index=0; 
    isStart=false;
  }
    
  if(isStart&&dataLen==0&&index>3){  
    isStart = false;
    parseData(); 
    index=0;
  }
}

unsigned char readBuffer(int index){
  return buffer[index]; 
}

void parseData() {
  isStart = false;
  int idx = readBuffer(3);
  command_index = (uint8_t)idx;
  int action = readBuffer(4);
  int device = readBuffer(5);
  int port = readBuffer(6);

  switch(action){
    case GET:{ // 매번 엔트리에서 요청하는 방식이 아닌, 하드웨어가 값을 계속 보내올 것을 1회성 요청하는 방식
      if(device == ULTRASONIC) {
        isUltrasonic = true;
        trigPin = readBuffer(6);
        echoPin = readBuffer(7);
        digitals[trigPin] = 0;  // Report Off
        digitals[echoPin] = 0;  // Report Off
        pinMode(trigPin, OUTPUT);
        pinMode(echoPin, INPUT);
        delay(50);

      } else if(device == DHTTEMP) {
        if (!dhtTempObj || (dhtTempPin != port)) { // 포트변경시 새 객체 생성
          if (dhtTempObj) delete dhtTempObj;
          dhtTempObj = new DHT(port, DHT11);
          dhtTempObj->begin();
        }
        dhtTempPin = port;
        digitals[port] = 0;  // Report Off
        isDhtTemp = true;
        
      } else if(device == DHTHUMI) {
        if (!dhtHumiObj || (dhtHumiPin != port)) { // 포트변경시 새 객체 생성
          if (dhtHumiObj) delete dhtHumiObj;
          dhtHumiObj = new DHT(port, DHT11);
          dhtHumiObj->begin();
        }
        dhtHumiPin = port;
        digitals[port] = 0;  // Report Off
        isDhtHumi = true;
        
      } else {
        // 신규 요청이 기 사용중인 포트와 겹치면 기존 것은 중지
        if(port == trigPin || port == echoPin) { 
          isUltrasonic = false;
        } else if(port == dhtTempPin) {
          isDhtTemp = false;
        } else if(port == dhtHumiPin) {
          isDhtHumi = false;
        }
        digitals[port] = 1; // 엔트리 요청에 의해 포트값을 보내야 할 때 On시킴 (digitalRead)
      }
    }
    break;
    case SET:{ //매번 엔트리에서 값을 set하는 방식
      runModule(device);
      // callOK();
    }
    break;
    case RESET:{
      // callOK();
    }
    break;
  }
}

void runModule(int device) {
  int port = readBuffer(6);
  int pin = port;

  // 신규 요청이 기 사용중인 포트와 겹치면 기존 것은 중지
  if(pin == trigPin || pin == echoPin) {
    isUltrasonic = false;
  } else if(port == dhtTempPin) {
    isDhtTemp = false;
  } else if(port == dhtHumiPin) {
    isDhtHumi = false;
  } 
  
  switch(device){
    case DIGITAL:{      
      setPortWritable(pin);
      int v = readBuffer(7);
      digitalWrite(pin,v);
    }
    break;
    case PWM:{
      setPortWritable(pin);
      int v = readBuffer(7);
      analogWrite(pin,v);
    }
    break;
    case TONE:{
      setPortWritable(pin);
      int hz = readShort(7);
      int ms = readShort(9);
      if(ms>0) {
        tone(pin, hz, ms);
      } else {
        noTone(pin);
      }
    }
    break;
    case SERVO_PIN:{
      setPortWritable(pin);
      int v = readBuffer(7);
      if(v>=0&&v<=180){ // 서모모터 SG-90으로 가정해 180까지
        Servo sv = servos[searchServoPin(pin)];
        sv.attach(pin);
        sv.write(v);
      }
    }
    break;
    case TIMER:{
      lastTime = millis()/1000.0; 
    }
    break;
    case STEPPER:{
      int p1 = readBuffer(7);
      int p2 = readBuffer(9);
      int p3 = readBuffer(11);
      int p4 = readBuffer(13);     
      int sp = readBuffer(15);
      int s = readShort(17); 
      if(s>=-2048&&s<=2048) { // 값이 최대 2048이므
        Stepper st(2048, p1, p2, p3, p4);
        st.setSpeed(sp);
        st.step(s);
      }
    }
    break;
  }
}

// For port monitoring in Entry
void sendPinValues() {  
  int pinNumber = 0;
  for (pinNumber = 0; pinNumber < sizeof(digitals); pinNumber++) {
    if(digitals[pinNumber] == 1) {
      sendDigitalValue(pinNumber);
      // callOK();
    }
  }
  for (pinNumber = 0; pinNumber < sizeof(analogs); pinNumber++) {
    if(analogs[pinNumber] == 1) {
      sendAnalogValue(pinNumber);
      // callOK();
    }
  }
  
  if(isUltrasonic) {
    sendUltrasonic();  
    // callOK();
  }

  if(isDhtTemp) {
    sendDhtTempValue();  
    // callOK();
  }

  if(isDhtHumi) {
    sendDhtHumiValue();  
    // callOK();
  }
}

void sendUltrasonic() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  float value = pulseIn(echoPin, HIGH) / 29.0 / 2.0;

  writeHead();
  sendFloat(value);
  writeSerial(trigPin);
  writeSerial(echoPin);
  writeSerial(ULTRASONIC);
  writeEnd();
}

void sendDhtTempValue() {
  int value = dhtTempObj->readTemperature();

  writeHead();
  sendShort(value);  
  writeSerial(dhtTempPin);
  writeSerial(DHTTEMP);
  writeEnd();
}

void sendDhtHumiValue() {
  int value = dhtHumiObj->readHumidity();

  writeHead();
  sendShort(value);  
  writeSerial(dhtHumiPin);
  writeSerial(DHTHUMI);
  writeEnd();
}

void sendDigitalValue(int pinNumber) {
  pinMode(pinNumber,INPUT);
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

void writeBuffer(int index,unsigned char c){
  buffer[index]=c;
}

void writeHead(){
  writeSerial(0xff);
  writeSerial(0x55);
}

void writeEnd(){
  Serial.println();
}

void writeSerial(unsigned char c){
  Serial.write(c);
}

void sendString(String s){
  int l = s.length();
  writeSerial(4);
  writeSerial(l);
  for(int i=0;i<l;i++){
    writeSerial(s.charAt(i));
  }
}

void sendFloat(float value){ 
  writeSerial(2);
  val.floatVal = value;
  writeSerial(val.byteVal[0]);
  writeSerial(val.byteVal[1]);
  writeSerial(val.byteVal[2]);
  writeSerial(val.byteVal[3]);
}

void sendShort(double value){
  writeSerial(3);
  valShort.shortVal = value;
  writeSerial(valShort.byteVal[0]);
  writeSerial(valShort.byteVal[1]);
}

short readShort(int idx){
  valShort.byteVal[0] = readBuffer(idx);
  valShort.byteVal[1] = readBuffer(idx+1);
  return valShort.shortVal; 
}

float readFloat(int idx){
  val.byteVal[0] = readBuffer(idx);
  val.byteVal[1] = readBuffer(idx+1);
  val.byteVal[2] = readBuffer(idx+2);
  val.byteVal[3] = readBuffer(idx+3);
  return val.floatVal;
}

long readLong(int idx){
  val.byteVal[0] = readBuffer(idx);
  val.byteVal[1] = readBuffer(idx+1);
  val.byteVal[2] = readBuffer(idx+2);
  val.byteVal[3] = readBuffer(idx+3);
  return val.longVal;
}

int searchServoPin(int pin){
  for(int i=0;i<8;i++){
    if(servo_pins[i] == pin){
      return i;
    }
    if(servo_pins[i]==0){
      servo_pins[i] = pin;
      return i;
    }
  }
  return 0;
}

void setPortWritable(int pin) {
  if(digitals[pin] == 1) { // 이전에 digitalRead 였으면 Report Off
    digitals[pin] = 0;    
  } 
  pinMode(pin, OUTPUT);
}

void callOK(){
  writeSerial(0xff);
  writeSerial(0x55);
  writeEnd();
}

void callDebug(char c){
  writeSerial(0xff);
  writeSerial(0x55);
  writeSerial(c);
  writeEnd();
}

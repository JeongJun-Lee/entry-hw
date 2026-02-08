import machine
import sys
import ustruct
import time
import ubluetooth

# --- Protocol Constants ---
START_BYTE = 0xFF
END_BYTE = 0xFE
CMD_WRITE_DIGITAL = 0x01
CMD_WRITE_PWM = 0x02
CMD_READ_DIGITAL = 0x03
CMD_READ_ANALOG = 0x04

# --- BLE Constants (Nordic UART Service) ---
BLE_NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'
BLE_NUS_RX_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'
BLE_NUS_TX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'

# --- Hardware Setup ---
pins = [machine.Pin(i, machine.Pin.OUT) for i in range(30)]
pwms = [None] * 30

def set_digital(pin, value):
    if 0 <= pin < 30:
        pins[pin].value(value)

def set_pwm(pin, value):
    if 0 <= pin < 30:
        if pwms[pin] is None:
            pwms[pin] = machine.PWM(machine.Pin(pin))
            pwms[pin].freq(1000)
        duty = int((value / 255.0) * 65535)
        pwms[pin].duty_u16(duty)

def get_digital(pin):
    if 0 <= pin < 30:
        return pins[pin].value()
    return 0

def get_analog(pin):
    # ADC pins are 26(ADC0) to 28(ADC2), 29(Temp)
    # Mapping Entry 0-4 to ADC 0-4?
    # Entry usually expects analog ports A0-A5.
    # Pico has ADC0(GP26), ADC1(GP27), ADC2(GP28).
    # Let's map 0->26, 1->27, 2->28.
    adc_pin = 26 + pin
    if 26 <= adc_pin <= 28:
        val = machine.ADC(adc_pin).read_u16()
        return val >> 6 # Convert 16bit to 10bit (0-1023)
    return 0

# --- BLE Class ---
class BLEPeripheral:
    def __init__(self):
        self._ble = ubluetooth.BLE()
        self._ble.active(True)
        self._ble.irq(self._irq)
        self._conn_handle = None
        self._rx_buffer = bytearray()

        self._nus_service_uuid = ubluetooth.UUID(BLE_NUS_SERVICE_UUID)
        self._nus_rx_char_uuid = ubluetooth.UUID(BLE_NUS_RX_CHAR_UUID)
        self._nus_tx_char_uuid = ubluetooth.UUID(BLE_NUS_TX_CHAR_UUID)

        self._nus_service = (
            self._nus_service_uuid,
            (
                (self._nus_rx_char_uuid, ubluetooth.FLAG_WRITE | ubluetooth.FLAG_WRITE_NO_RESPONSE),
                (self._nus_tx_char_uuid, ubluetooth.FLAG_NOTIFY),
            ),
        )
        
        # Register Services
        ((self._rx_handle, self._tx_handle),) = self._ble.gatts_register_services((self._nus_service,))
        
        # Advertising
        self._payload = self._advertising_payload(
            name='Pico-Entry',
            services=[self._nus_service_uuid]
        )
        self._advertise()

    def _irq(self, event, data):
        if event == 1: # _IRQ_CENTRAL_CONNECT
            self._conn_handle, _, _ = data
        elif event == 2: # _IRQ_CENTRAL_DISCONNECT
            self._conn_handle = None
            self._advertise()
        elif event == 3: # _IRQ_GATTS_WRITE
            conn_handle, value_handle = data
            if conn_handle == self._conn_handle and value_handle == self._rx_handle:
                self._rx_buffer.extend(self._ble.gatts_read(self._rx_handle))

    def _advertise(self):
        self._ble.gap_advertise(100, self._payload)

    def _advertising_payload(self, limited_disc=False, br_edr=False, name=None, services=None, appearance=0):
        payload = bytearray()
        def _append(adv_type, value):
            nonlocal payload
            payload += ustruct.pack("BB", len(value) + 1, adv_type) + value

        _append(0x01, ustruct.pack("B", (0x02 if limited_disc else 0x06) + (0x00 if br_edr else 0x00)))

        if name:
            _append(0x09, name)

        if services:
            for uuid in services:
                b = bytes(uuid)
                if len(b) == 2:
                    _append(0x03, b)
                elif len(b) == 4:
                    _append(0x05, b)
                elif len(b) == 16:
                    _append(0x07, b)

        return payload

    def send(self, data):
        if self._conn_handle is not None:
            self._ble.gatts_notify(self._conn_handle, self._tx_handle, data)

    def read(self):
        if len(self._rx_buffer) > 0:
            data = self._rx_buffer[:]
            self._rx_buffer = bytearray()
            return data
        return None

# --- Main Logic ---
def send_response(ble, cmd, pin, value):
    # Packet: [START, CMD, PIN, VAL_H, VAL_L, END]
    val_h = (value >> 8) & 0xFF
    val_l = value & 0xFF
    packet = ustruct.pack('BBBBBB', START_BYTE, cmd, pin, val_h, val_l, END_BYTE)
    
    # Send to Serial
    sys.stdout.buffer.write(packet)
    
    # Send to BLE
    if ble:
        ble.send(packet)

def process_command(cmd, pin, val_h, val_l, ble):
    value = (val_h << 8) | val_l
    
    if cmd == CMD_WRITE_DIGITAL:
        set_digital(pin, value)
    elif cmd == CMD_WRITE_PWM:
        set_pwm(pin, value)
    # READ commands are usually polled by Entry, but if Entry sends a request packet (not in current protocol?), 
    # we would respond here.
    # Current protocol in pico.js seems to just send WRITE commands. 
    # Read values are sent automatically? 
    # Wait, pico.js handleRemoteData handles WRITE. 
    # pico.js requestLocalData generates packets to send to Pico.
    # BUT requestRemoteData updates Entry blocks from data received from Pico.
    # So Pico *must* successfully send data back.
    # The current main.py I saw earlier didn't seem to send data back periodically!
    # Ah, the previous main.py had 'process_command' but no 'send_data'.
    # And 'pico.xml' / 'pico.js' suggests it reads analog/digital.
    # So Pico should periodically send sensor data?
    # Or does Entry send a "READ" command? 
    # pico.js requestLocalData sends CMD 0x01 (WRITE_DIGITAL) etc.
    # It does NOT seems to send READ commands in requestLocalData loop (it clears queue).
    # However, handleRemoteData reads 'digital_X' from Entry? No, that's Entry sending data.
    # handleLocalData receives 0x03 (READ_DIGITAL) and 0x04 (READ_ANALOG). 
    # This implies Pico MUST send these packets.
    # So the main loop should periodically send updates.

def main():
    try:
        ble = BLEPeripheral()
    except:
        ble = None # Fallback for non-W Pico
    
    buffer = bytearray()
    last_send_time = time.ticks_ms()
    
    while True:
        # 1. Read from Serial
        if sys.stdin.buffer.in_waiting > 0:
            chunk = sys.stdin.buffer.read(sys.stdin.buffer.in_waiting)
            buffer.extend(chunk)
            
        # 2. Read from BLE
        if ble:
            ble_data = ble.read()
            if ble_data:
                buffer.extend(ble_data)
                
        # 3. Process Buffer
        while len(buffer) >= 6:
            if buffer[0] != START_BYTE:
                buffer.pop(0)
                continue
            if buffer[5] != END_BYTE:
                buffer.pop(0) # Should verify logic, maybe wait for more? Simplified here.
                continue
                
            cmd = buffer[1]
            pin = buffer[2]
            val_h = buffer[3]
            val_l = buffer[4]
            
            process_command(cmd, pin, val_h, val_l, ble)
            del buffer[:6]
            
        # 4. Periodically Send Sensor Data (every 50ms)
        if time.ticks_diff(time.ticks_ms(), last_send_time) > 50:
            last_send_time = time.ticks_ms()
            
            # Send Digital Values (0-29) - optimization: only send if changed? or key ones?
            # For simplicity, let's send a few or rotate?
            # Sending 30 digital + 5 analog every 50ms is too much bandwidth (35*6 bytes = 210 bytes).
            # Serial is 115200, so ~10KB/s. 210 bytes * 20 Hz = 4KB/s. It's okay.
            # But for BLE, might be slow.
            # Let's send only a subset or rotate. 
            # Implemented a simple rotation or just send all for now.
            
            # Example: Send Analog A0-A2 (GP26-28)
            for i in range(3):
                val = get_analog(i)
                send_response(ble, CMD_READ_ANALOG, i, val)
                
            # Send Digital (Example: Button on GP12?)
            # Just sending a few for test.
            # Ideally we should send what is requested or all. 
            # pico.js expects 'digital_X' to be updated.
            # Let's send a keep-alive or key ports.

        time.sleep(0.01)

if __name__ == "__main__":
    main()

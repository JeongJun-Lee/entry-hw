import machine
import sys
import ustruct
import time

# Protocol Constants
START_BYTE = 0xFF
END_BYTE = 0xFE

CMD_WRITE_DIGITAL = 0x01
CMD_WRITE_PWM = 0x02
CMD_READ_DIGITAL = 0x03
CMD_READ_ANALOG = 0x04

# Setup Pins
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
        
        # Entry sends 0-255? or raw duty? Assuming 0-255 map to 0-65535
        duty = int((value / 255.0) * 65535)
        pwms[pin].duty_u16(duty)

def process_command(cmd, pin, val_h, val_l):
    value = (val_h << 8) | val_l
    
    if cmd == CMD_WRITE_DIGITAL:
        set_digital(pin, value)
    elif cmd == CMD_WRITE_PWM:
        set_pwm(pin, value)

def main():
    buffer = bytearray()
    
    while True:
        if sys.stdin.buffer.in_waiting > 0:
            chunk = sys.stdin.buffer.read(sys.stdin.buffer.in_waiting)
            buffer.extend(chunk)
            
            while len(buffer) >= 6:
                # Check Start Byte
                if buffer[0] != START_BYTE:
                    buffer.pop(0)
                    continue
                
                # Check End Byte
                if buffer[5] != END_BYTE:
                    buffer.pop(0)
                    continue
                    
                # Parse Packet
                cmd = buffer[1]
                pin = buffer[2]
                val_h = buffer[3]
                val_l = buffer[4]
                
                process_command(cmd, pin, val_h, val_l)
                
                # Remove packet
                del buffer[:6]
                
        time.sleep(0.01)

if __name__ == "__main__":
    main()

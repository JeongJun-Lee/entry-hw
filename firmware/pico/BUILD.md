# How to Build Custom MicroPython Firmware for Pico

To distribute a single `.uf2` file that contains both the MicroPython interpreter and your `main.py` script, you need to compile MicroPython from source and "freeze" your script into it.

## Method 1: Using Docker (Recommended)

The easiest way is to use a Docker container that has the toolchain pre-installed.

1.  **Prepare Directory**:
    Create a folder named `modules` inside your current directory and place your `main.py` in it.
    ```bash
    mkdir -p modules
    # Download picozero
    git clone https://github.com/roboticsware/picozero.git
    cp picozero/picozero.py modules/
    cp main.py modules/
    ```

2.  **Run Build Command**:
    This command will download the MicroPython source, inject your `modules` folder, and compile it.
    *(Note: This uses a standard ARM GCC container)*

    ```bash
    docker run --rm -v $(pwd):/workspace -w /workspace arm32v7/ubuntu:20.04 /bin/bash -c "
      apt-get update && apt-get install -y git make python3 gcc-arm-none-eabi build-essential cmake
      git clone https://github.com/micropython/micropython.git
      cd micropython
      git submodule update --init --lib/pico-sdk lib/tinyusb
      cd mpy-cross && make && cd ..
      
      # Copy your main.py to the frozen modules directory
      cp /workspace/modules/*.py ports/rp2/modules/
      
      # Build for Standard Pico
      cd ports/rp2
      make BOARD=PICO
      cp build-PICO/firmware.uf2 /workspace/pico.uf2
      
      # Build for Pico W
      make BOARD=PICO_W
      cp build-PICO_W/firmware.uf2 /workspace/pico_ble.uf2
    "
    ```

## Method 2: Manual Build (Linux/Mac)

If you have the ARM Toolchain installed (`arm-none-eabi-gcc`):

1.  **Clone MicroPython**:
    ```bash
    git clone https://github.com/micropython/micropython.git
    cd micropython
    git submodule update --init -- recursivelib/pico-sdk lib/tinyusb
    ```

2.  **Build mpy-cross**:
    ```bash
    make -C mpy-cross
    ```

3.  **Add your script and libraries**:
    Copy your `main.py` and `picozero` library into `ports/rp2/modules/`.
    ```bash
    # Download picozero
    git clone https://github.com/roboticsware/picozero.git
    cp picozero/picozero.py ports/rp2/modules/

    # Copy main.py
    cp /path/to/your/main.py ports/rp2/modules/
    ```

4.  **Build Firmware**:
    *   **Standard Pico**:
        ```bash
        cd ports/rp2
        make BOARD=PICO
        mv build-PICO/firmware.uf2 build-PICO/pico.uf2
        ```
    *   **Pico W**:
        ```bash
        make BOARD=PICO_W
        mv build-PICO_W/firmware.uf2 build-PICO_W/pico_ble.uf2
        ```
    * 5.  **Output**:
    The resulting files will be:
    - `ports/rp2/build-PICO/pico.uf2`
    - `ports/rp2/build-PICO_W/pico_ble.uf2`


## Method 3: Windows (WSL - Ubuntu)

1.  **Install WSL**:
    Open PowerShell as Administrator and run:
    ```powershell
    wsl --install
    ```
    Restart your computer if asked.

2.  **Install Dependencies (in Ubuntu terminal)**:
    ```bash
    sudo apt update
    sudo apt install -y git make python3 gcc-arm-none-eabi build-essential cmake
    ```

3.  **Clone MicroPython**:
    ```bash
    git clone https://github.com/micropython/micropython.git
    cd micropython
    git submodule update --init --lib/pico-sdk lib/tinyusb
    ```

4.  **Build mpy-cross**:
    ```bash
    make -C mpy-cross
    ```

5.  **Add your script and libraries**:
    In WSL, you can access your Windows files from `/mnt/c/Users/...`.
    Copy your `main.py` and `picozero` library into `ports/rp2/modules/`.

    ```bash
    # Download picozero
    git clone https://github.com/roboticsware/picozero.git
    cp picozero/picozero.py ports/rp2/modules/
    
    # Copy main.py
    cp /mnt/c/Users/YourName/path/to/main.py ports/rp2/modules/
    ```

7.  **Build Firmware**:
    You need to build two versions: one for standard Pico (USB) and one for Pico W (BLE + USB).

    *   **For Standard Pico (USB Only)**:
        ```bash
        cd ports/rp2
        make BOARD=PICO
        # Rename output
        mv build-PICO/firmware.uf2 build-PICO/pico.uf2
        ```
    
    *   **For Pico W (BLE + USB)**:
        ```bash
        cd ports/rp2
        make BOARD=PICO_W
        # Rename output
        mv build-PICO_W/firmware.uf2 build-PICO_W/pico_ble.uf2
        ```

8.  **Get Output**:
    Copy the result back to Windows:
    ```bash
    # Standard Pico
    cp build-PICO/pico.uf2 /mnt/c/Users/YourName/Desktop/
    # Pico W
    cp build-PICO_W/pico_ble.uf2 /mnt/c/Users/YourName/Desktop/
    ```

## Firmware Files
- **pico.uf2**: Use this for standard **Raspberry Pi Pico**. (Connects via `pico.json`)
- **pico_ble.uf2**: Use this for **Raspberry Pi Pico W**. (Connects via `pico_ble.json`)`


## Why do this?
- **User Convenience**: Users just drag ONE file, and everything works.
- **Reliability**: Use `main.py` cannot be easily deleted or modified by accident.
- **Performance**: Frozen modules use less RAM.

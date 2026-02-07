# How to Build Custom MicroPython Firmware for Pico

To distribute a single `.uf2` file that contains both the MicroPython interpreter and your `main.py` script, you need to compile MicroPython from source and "freeze" your script into it.

## Method 1: Using Docker (Recommended)

The easiest way is to use a Docker container that has the toolchain pre-installed.

1.  **Prepare Directory**:
    Create a folder named `modules` inside your current directory and place your `main.py` in it.
    ```bash
    mkdir -p modules
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
      
      # Build
      cd ports/rp2
      make
      
      # Copy output back
      cp build-PICO/firmware.uf2 /workspace/pico_custom.uf2
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

3.  **Add your script**:
    Copy your `main.py` (and any other `.py` files) into `ports/rp2/modules/`.
    ```bash
    cp /path/to/your/main.py ports/rp2/modules/
    ```

4.  **Build Firmware**:
    ```bash
    cd ports/rp2
    make
    ```

5.  **Output**:
    The resulting file will be at `ports/rp2/build-PICO/firmware.uf2`.

## Why do this?
- **User Convenience**: Users just drag ONE file, and everything works.
- **Reliability**: Use `main.py` cannot be easily deleted or modified by accident.
- **Performance**: Frozen modules use less RAM.

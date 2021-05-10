import { ChildProcess, exec } from 'child_process';
import createLogger from '../../electron/functions/createLogger';
import directoryPaths from '../directoryPaths';

const logger = createLogger('core/SerialFlasher.ts');

const platform = process.platform;

/**
 * 아두이노/다른 하드웨어의 컴파일 기능을 담당한다.
 * 아두이노 계열 파일의 컴파일은 main/firmwares/core 에 있는 파일을 커맨드라인 실행한다.
 */
class Compiler {
    private compilerProcess?: ChildProcess;

    private _compileArduino(): Promise<any[]> {
        return new Promise((resolve) => {
            let cliName;
            let cliCmd = 'compile';
            let cliFqbn = 'arduino:avr:uno';
            let cliConf = 'arduino-cli.yaml';
            let outputDir = '.';

            if (platform === 'darwin') {
                cliName = './arduino-cli';
            } else {
                cliName = 'arduino-cli.exe';
            }

            const cmd = [
                cliName,
                ' ',
                cliCmd,
                ' --fqbn ',
                cliFqbn,
                ' --config-file ',
                cliConf,
                ' --output-dir ',
                outputDir,
            ].join('');

            logger.info(`arduino board compile requested.\nparameter is ${cmd}`);

            this.compilerProcess = exec(
                cmd,
                {
                    cwd: directoryPaths.firmware(),
                },
                (...args) => {
                    resolve(args);
                }
            );
        });
    }


    compile(firmwareName: string): Promise<any[]> {
        if (firmwareName == 'Arduino' || firmwareName == 'ArduinoEx') {
            return this._compileArduino();
        } else {
            return Promise.reject(new Error());
        }
    }

    kill() {
        if (this.compilerProcess) {
            this.compilerProcess.kill();
            this.compilerProcess = undefined;
        }
    }
}

export default Compiler;

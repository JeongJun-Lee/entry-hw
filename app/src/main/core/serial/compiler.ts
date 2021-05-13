import { ChildProcess, exec } from 'child_process';
import createLogger from '../../electron/functions/createLogger';
import directoryPaths from '../directoryPaths';
import rendererConsole from '../rendererConsole';
import alert from 'alert';

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

            logger.info(`arduino code compile requested.\nparameter is ${cmd}`);

            this.compilerProcess = exec(
                cmd,
                {
                    cwd: directoryPaths.firmware(),
                },
                (...args) => {
                    resolve(args);
                },
            );
        });
    }


    compile(firmwareName: string): Promise<boolean> {
        if (firmwareName == 'Arduino' || firmwareName == 'ArduinoEx') {
            return new Promise((resolve, reject) => {this._compileArduino()
                    .then(([error, ...args]) => {
                        if (error) {
                            rendererConsole.log('CompileError', error.message);
                            console.log(error.message);
                            alert(error.message);
                            reject(new Error('Firmware compile is Failed!!!'));
                            
                        } else {
                            logger.info('firmware flash success');
                            resolve(true);
                        }
                    });
                });
        } else {
            return Promise.reject(new Error('Not supported compile request'));
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

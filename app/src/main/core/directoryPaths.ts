import path from 'path';
import { app } from 'electron';

let rootAppPath = path.join(__dirname, '..', '..');
const userDataPath = path.join(app.getPath('appData'), 'entry-hw');

export default {
    setRootAppPath: (nextPath: string) => {
        rootAppPath = nextPath;
    },
    driver: () => path.join(rootAppPath, 'drivers'),
    firmware: () => path.join(rootAppPath, 'firmwares'),
    modules: () => path.join(rootAppPath, 'modules'),
    firmwares: () => path.join(userDataPath, 'firmwares'),
};


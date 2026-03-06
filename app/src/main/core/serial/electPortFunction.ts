import SerialConnector from './connector';

type IElectedResult = { port: string; connector: SerialConnector; };

const electPort = async (
    ports: string[],
    hwConfig: IHardwareModuleConfig,
    hwModule: IHardwareModule,
    beforeConnectCallback: (connector: SerialConnector) => void,
    handshakePayload?: () => string | undefined,
) => {
    if (!ports || ports.length === 0) {
        return;
    }

    // 선출 후보 포트별 커넥터 객체 미리 생성
    const connectors: IElectedResult[] = ports.map((port) => ({
        port,
        connector: new SerialConnector(hwModule, hwConfig),
    }));

    let isBeforeConnectCalled = false;

    try {
        const electedConnector = await new Promise<IElectedResult | undefined>((resolve, reject) => {
            let errorCount = 0;

            connectors.forEach(async (connectorObject) => {
                try {
                    const { connector, port } = connectorObject;
                    await connector.open(port);

                    if (beforeConnectCallback && !isBeforeConnectCalled) {
                        isBeforeConnectCalled = true;
                        beforeConnectCallback(connector);
                    }

                    await connector.initialize(handshakePayload);
                    resolve(connectorObject);
                } catch (e) {
                    console.log(`port ${connectorObject.port} elect initialize error`, e);
                    errorCount++;
                    if (errorCount === connectors.length) {
                        reject(new Error('All ports failed to elect'));
                    }
                }
            });
        });

        if (electedConnector) {
            // 선출되지 못한 포트들 전부 다시 닫기
            _finalize(connectors.filter(({ port }) => port !== electedConnector.port));
        } else {
            _finalize(connectors);
        }

        return electedConnector;
    } catch (e) {
        // 모든 포트가 에러 발생(타임아웃 등) 시 열려있는 모든 포트 닫기
        _finalize(connectors);
        return undefined;
    }
};

const _finalize = (connectors: IElectedResult[]) => {
    connectors.forEach(({ connector }) => {
        connector.close();
    });
};

export default electPort;

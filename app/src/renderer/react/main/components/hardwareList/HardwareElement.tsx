import React, { useCallback, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { changeCurrentPageState } from '../../store/modules/common';
import { HardwareAvailableTypeEnum, HardwarePageStateEnum } from '../../constants/constants';
import { selectHardware } from '../../store/modules/connection';
import styled from 'styled-components';
import { requestHardwareModuleDownload } from '../../store/modules/hardware';
import EmptyDeviceImage from '../../../../images/empty_module_image.png';
import usePreload from '../../hooks/usePreload';

const HardwareTypeDiv = styled.div`
    width: 170px;
    height: 170px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
`;

const HardwareThumbnailContainer = styled.div`
    width: 100px;
    height: 100px;
    cursor: pointer;
    display: flex;
`;

const HardwareThumbnailImg = styled.img<{ type: HardwareAvailableTypeEnum }>`
    max-width: 100px;
    margin: auto;
    cursor: pointer;
    ${({ type }) => {
        if (type !== HardwareAvailableTypeEnum.available) {
            return 'filter: grayscale(1);';
        }
    }}
`;

const HardwareTitle = styled.h2`
    font-size: 12px;
    color: #595757;
    margin-top: 15px;
    cursor: pointer;
    display: flex;
`;

const SUPPORTED_HARDWARE_IDS = [
    '050501', // Neo Soco (neobot_purple)
    '010101', // Arduino Uno (arduino)
    '010199', // Arduino Compatible (arduinoCompatible)
    '010901', // Arduino Ext (arduinoExt)
    '010904', // Arduino Ext BT (arduinoExt_bt)
    '011001', // Arduino Nano (arduinoNano)
    '011301', // Rauf NanoBoard (arduinoNanoExt)
    '120101', // EV3 (ev3)
    '120102', // EV3 HID (ev3_hid)
    '050401', // NEOCODING Game Theme (neobot_game_theme)
    '050301', // NEOCODING Robot Theme (neobot_robot_theme)
    '050302', // NEOCODING Robot Theme New (neobot_robot_theme_dongle)
    '050201', // NEOCODING SensorTheme (neobot_sensor_theme)
    '220301', // micro:bit V1 + V2 (microbit2)
    '020402', // Hamster (hamster)
    '5E0101', // ITPLE Board (ITPLE)
    '020901', // Turtle (turtle)
];

const HardwareElement: React.FC<{ hardware: IHardwareConfig }> = (props) => {
    const { translator, rendererRouter } = usePreload();
    const dispatch = useDispatch();
    const { hardware } = props;
    const { availableType } = hardware;

    const [isImageSrcNotFound, setImageNotFound] = useState(false);
    const langType = useMemo(() => translator.currentLanguage, [translator]);
    const onElementClick = useCallback(() => {
        if (!SUPPORTED_HARDWARE_IDS.includes(hardware.id)) {
            alert(translator.translate('If you need support, please contact RoboticsWare'));
            return;
        }

        if (availableType === HardwareAvailableTypeEnum.available) {
            selectHardware(dispatch)(hardware);
            changeCurrentPageState(dispatch)(HardwarePageStateEnum.connection);
        } else {
            hardware.moduleName
                ? requestHardwareModuleDownload(dispatch)(hardware.moduleName)
                : console.log('moduleName is not defined');
        }
    }, [hardware, availableType]);

    const getImageBaseSrc = useMemo(() => {
        if (isImageSrcNotFound) {
            return EmptyDeviceImage;
        }

        const imageBaseUrl = rendererRouter.sharedObject.moduleResourceUrl;

        switch (availableType) {
            case HardwareAvailableTypeEnum.needUpdate:
            case HardwareAvailableTypeEnum.needDownload:
                return `${imageBaseUrl}/${hardware.moduleName}/files/image`;
            case HardwareAvailableTypeEnum.available:
            default:
                return `${rendererRouter.baseModulePath}/${hardware.icon}`;
        }
    }, [isImageSrcNotFound, availableType]);

    return (
        <HardwareTypeDiv id={`${hardware.id}`} onClick={onElementClick}>
            <HardwareThumbnailContainer>
                <HardwareThumbnailImg
                    src={getImageBaseSrc}
                    type={availableType}
                    alt=""
                    onError={() => {
                        setImageNotFound(true);
                    }}
                />
            </HardwareThumbnailContainer>
            <HardwareTitle>
                {`${hardware.name && hardware.name[langType] || hardware.name.en}`}
            </HardwareTitle>
        </HardwareTypeDiv>
    );
};

export default HardwareElement;


![Entry Logo](app/src/renderer/images/about/logo.png)

1.9.20

## [![Action Build Status](https://github.com/entrylabs/entry-hw/workflows/Build%20%26%20Deploy/badge.svg)](https://github.com/entrylabs/entry-hw/actions?query=workflow%3A"Build+%26+Deploy")

## What is Entry Hardware

entry-hw는 엔트리와 하드웨어를 연동하기 위한 프로그램 입니다.  
엔트리 사이트에 접속하시면 엔트리를 사용한 블록코딩 환경과 하드웨어를 연동하는 모습을 확인해 볼 수 있습니다.

## Prerequisite

#### Node.js

Node.js 는 개발 전반을 위해 반드시 설치가 되어야하는 프레임워크입니다. 작업 전 가장 먼저 설치합니다.

> https://nodejs.org

#### Yarn(optional)

> npm install --global yarn

엔트리 하드웨어는 yarn 을 통해 의존성을 관리 중입니다. npm 을 사용해도 문제는 없습니다.

#### Node-gyp

엔트리 하드웨어는 [node-serialport](https://github.com/node-serialport/node-serialport) 를 사용합니다.  
해당 라이브러리를 사용하기 위해서는 C++, python 빌드 환경과 [node-gyp](https://github.com/nodejs/node-gyp) 라이브러리가 필요합니다.  
빌드에 대한 자세한 사항은 [node-gyp#installation](https://github.com/nodejs/node-gyp#installation) 을 참고해 주세요.

먼저 빌드 환경을 구성해야 합니다.  
윈도우의 경우, 관리자 권한 명령 프롬프트에서

```bash
npm install --global --production windows-build-tools
```

로 한번에 설치할 수 있습니다. [Windows-Build-Tools](https://github.com/felixrieseberg/windows-build-tools) 를 참고해 주세요.

```bash
npm install --global node-gyp
```

## CommandLine arguments

프로그램 실행시 인자를 추가하는 것으로 프로그램 설정을 변경할 수 있습니다.

-   --debug (-d, default = false): 프로그램 실행시 개발자콘솔(devtool) 이 같이 오픈됩니다.
-   --config (-c, default = 'entry'): config 파일 명칭을 선택합니다. 위치는 \<projectPath\>/config/config.${name}.json 입니다.
-   --lang (-l): locale 을 설정할 수 있습니다. 기본적으로 ko, en, jp 를 지원합니다. 코드 기여를 통해 타 다국어를 지원하게 만들 수 있습니다.
    -   lang 은 기본적으로 OS 의 locale 값을 따릅니다.

## Entry Hardware Full Documentation

[Entry Docs](https://entrylabs.github.io/docs/guide/entry-hw/2016-05-01-getting_started.html)

## Copyright and License

[The MIT License (MIT)](https://github.com/entrylabs/entry-hw/blob/master/LICENSE)

## Arduino Tools Management

`Arduino15` 폴더는 OS별(Windows, Mac)로 실행 파일이 다르므로 Git에서 각각 관리합니다. 개발 및 빌드 환경 구성을 위해 아래 가이드를 참고하세요.

### 1. OS별 링크 도구 요약 가이드

| 작업 | 윈도우 (CMD/PowerShell) | 맥 (Terminal) |
| :--- | :--- | :--- |
| **링크 생성** | `mklink /J Arduino15 Arduino15_win` | `ln -s Arduino15_mac Arduino15` |
| **링크 삭제** | `rmdir Arduino15` | `rm Arduino15` |

### 2. 빌드 주의사항
*   **Git 관리**: Git에는 `Arduino15_win`과 `Arduino15_mac` 폴더만 추적됩니다. 개발 시 생성한 `Arduino15` 링크는 `.gitignore`에 의해 제외됩니다.
*   **패키징**: `electron-builder.json` 설정에 따라 빌드 시 각각의 OS에 맞는 `Arduino15_xxx` 폴더가 최종 패키지의 `firmwares/Arduino15` 경로로 자동 매핑됩니다.

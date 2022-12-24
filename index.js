const { app, BrowserWindow, Menu, systemPreferences } = require('electron')
const cp = require("child_process");
const path = require('path')
const url = require('url')
const fs = require('fs');
const util = require('util');
const process = require('process');

const execFile = util.promisify(cp.execFile);

const _MODELS = {
    "tiny.en": "https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt",
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base.en": "https://openaipublic.azureedge.net/main/whisper/models/25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead/base.en.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small.en": "https://openaipublic.azureedge.net/main/whisper/models/f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872/small.en.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium.en": "https://openaipublic.azureedge.net/main/whisper/models/d7440d1dc186f76616474e0ff0b3b6b879abc9d1a4926b7adfa41db2d497ab4f/medium.en.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v2.pt",
}

const _MODEL_ORDER = [
    "tiny.en",
    "tiny",
    "base.en",
    "base",
    "small.en",
    "small",
    "medium.en",
    "medium",
    "large",
]

const _DATA_DIR = path.join(app.getPath('userData'), 'whisper')
const _CONFIG_FILE = path.join(_DATA_DIR, 'config.json')
const _MODEL_DIR = path.join(_DATA_DIR, 'models')
const _WHISPER_DIR = path.join(_DATA_DIR, 'whisper')

async function do_get_model(model) {
    // check if whisper exists
    if (!fs.existsSync(_WHISPER_DIR)) {
        fs.mkdirSync(_DATA_DIR, { recursive: true });
        let whisper_url = 'https://github.com/openai/whisper/archive/b9265e5796f5d80c18d1f9231ab234225676780b.tar.gz'
        let whisper_file = path.join(_DATA_DIR, 'whisper.tar.gz')
        await execFile('curl', ['-L', whisper_url, '-o', whisper_file])
        await execFile('tar', ['-xzf', whisper_file, '-C', _DATA_DIR])
        await execFile('mv', [path.join(_DATA_DIR, 'whisper-b9265e5796f5d80c18d1f9231ab234225676780b'), _WHISPER_DIR])
    }

    // Check if pt model exists
    let pt_model_path = path.join(_MODEL_DIR, model + '.pt')
    if (!fs.existsSync(pt_model_path)) {
        fs.mkdirSync(_MODEL_DIR, { recursive: true });
        let model_url = _MODELS[model]
        let model_file = path.join(_MODEL_DIR, model + '.pt')
        await execFile('curl', ['-L', model_url, '-o', model_file])
    }

    let bin_model_path = path.join(_MODEL_DIR, model + '.bin')
    if (!fs.existsSync(bin_model_path)) {
        await execFile(path.join(app.getAppPath(), 'deps/python-env/bin/dpython'), [path.join(app.getAppPath(), 'deps/whisper.cpp/models/convert-pt-to-ggml.py'), pt_model_path, _WHISPER_DIR, _DATA_DIR])
        await execFile('mv', [path.join(_DATA_DIR, 'ggml-model.bin'), bin_model_path])
    }

    return bin_model_path
}

let streamer = null;
let config = null;
let curr_line = ""
let prev_lines = []


async function start_streamer(mainWindow) {
    if (streamer) {
        // send sigint to streamer
        streamer.kill();
    }

    const model = config.model;

    mainWindow.webContents.send('prev-lines', "");
    mainWindow.webContents.send('curr-line', "Loading model...");

    let model_path = await do_get_model(model);

    mainWindow.webContents.send('curr-line', "Loaded! Starting streaming...");

    const args = ["-m", model_path, "-t", "7", "--step", "500", "--length", "500", "-c", "0", "-ac", "512"];

    streamer = cp.spawn(path.join(app.getAppPath(), 'deps/whisper.cpp/stream'), args, {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('running');

    streamer.stdout.on('data', (data) => {
        d_lines = data.toString().split("\n")
        if (d_lines.length > 1) {
            d_lines[0] = curr_line + d_lines[0]
            for (let i = 0; i < d_lines.length - 1; i++) {
                // everything after the final \r
                let line = d_lines[i].split("\r").slice(-1)[0]
                prev_lines.push(line)
            }
        } else {
            curr_line += d_lines[0]
            curr_line = curr_line.split("\r").slice(-1)[0]
        }

        mainWindow.webContents.send('prev-lines', prev_lines.join("<br/>"))
        mainWindow.webContents.send('curr-line', curr_line)
    });
}

async function createWindow () {
    // start new window in full screen
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    })
    mainWindow.maximize()
    const powerSaveBlocker = electron.remote.powerSaveBlocker;
    powerSaveBlocker.start('prevent-display-sleep');

    mainWindow.loadFile('index.html')

    systemPreferences.askForMediaAccess('microphone').then((granted) => {
        if (granted) {
            console.log('granted')
        } else {
            console.log('denied')
        }
    })

    // load config if exists
    config = {}
    if (fs.existsSync(_CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(_CONFIG_FILE))
    }

    // get list of mics

    const { stdout: mics } = await execFile(path.join(app.getAppPath(), 'deps/whisper.cpp/stream'), ["-mi"]);

    const micList = mics.split("\n").filter(x => x.length > 0)

    if (config.mic == null) {
        config.mic = micList[0]
    }

    if (config.model == null) {
        config.model = "base.en"
    }

    if (config.font_size == null) {
        config.font_size = 64
    }

    let model_menu_items = [];
    for (let model of _MODEL_ORDER) {
        model_menu_items.push({
            label: model,
            type: 'radio',
            checked: config.model == model,
            click: () => {
                config.model = model;
                fs.writeFileSync(_CONFIG_FILE, JSON.stringify(config));
                start_streamer(mainWindow);
            }
        })
    }

    let microphone_menu_items = [];
    for (let mic of micList) {
        microphone_menu_items.push({
            label: mic,
            type: 'radio',
            checked: config.mic == mic,
            click: () => {
                config.mic = mic;
                fs.writeFileSync(_CONFIG_FILE, JSON.stringify(config));
                start_streamer(mainWindow);
            }
        })
    }

    let font_size_menu_items = [];
    for (let size of [32, 48, 64, 96, 128]) {
        font_size_menu_items.push({
            label: size.toString(),
            type: 'radio',
            checked: config.font_size == size,
            click: () => {
                config.font_size = size;
                fs.writeFileSync(_CONFIG_FILE, JSON.stringify(config));
                mainWindow.webContents.send('font-size', size)
            }
        })
    }

    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'Quit',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Model',
            submenu: model_menu_items
        },
        {
            label: 'Microphone',
            submenu: microphone_menu_items
        },
        {
            label: 'Font Size',
            submenu: font_size_menu_items
        }
    ])

    Menu.setApplicationMenu(menu);


    mainWindow.webContents.on('did-finish-load', async () => {
        mainWindow.webContents.send('font-size', config.font_size)
        await start_streamer(mainWindow);
    })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

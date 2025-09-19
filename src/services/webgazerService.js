class WebGazerService {
  constructor() {
    this.isInitialized = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async init() {
    try {
      // 动态加载WebGazer脚本
      await this.loadScript();

      // 初始化WebGazer
      await webgazer
        .setRegression('ridge')
        .setTracker('clmtrackr')
        .begin();

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('WebGazer初始化失败:', error);
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`正在重试初始化 (${this.retryCount}/${this.maxRetries})`);
        return new Promise(resolve => {
          setTimeout(async () => {
            resolve(await this.init());
          }, 2000);
        });
      }
      throw error;
    }
  }

  loadScript() {
    return new Promise((resolve, reject) => {
      if (typeof webgazer !== 'undefined') return resolve();

      const script = document.createElement('script');
      script.src = 'https://webgazer.cs.brown.edu/webgazer.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

export const webgazerService = new WebGazerService();
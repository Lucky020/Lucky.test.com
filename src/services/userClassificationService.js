/**
 * 用户分类服务 - 基于眼动追踪数据将用户分为三类:
 * 1. 直接型(Direct)
 * 2. 对照型(Referential) 
 * 3. 探索型(Exploratory)
 */

export class UserClassificationService {
  /**
   * 重置缩放状态 - 将所有区域缩放还原到默认值(1.0)
   */
  /**
   * 放大指定区域
   * @param {string} area - 要放大的区域标识符(a/b/c/f)
   * @param {number} [scale=1.5] - 缩放比例(默认1.5倍)
   */
  zoomArea(area, scale = 1.5) {
    try {
      // 增强区域验证（包含所有有效区域）
      const validAreas = {
        'a': '左侧任务区',
        'b': '右上提示区',
        'c': '中央代码区',
        'f': '右下历史区'
      };

      if (!(area in validAreas)) {
        const errorMsg = `非法区域: ${area}, 有效区域: ${Object.keys(validAreas).join(', ')}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      // 确保回调函数已设置
      if (!this.onZoomChange) {
        console.warn('onZoomChange回调未设置，使用默认回调');
        this.onZoomChange = (state) => {
          console.log('默认zoom回调:', state);
          if (window.updateZoomState) {
            window.updateZoomState(state);
          }
        };
      }

      // 先重置所有区域
      this.resetZoom();

      // 设置目标区域缩放
      this.zoomState[area] = scale;
      console.log(`区域 ${area} 已放大 ${scale} 倍`);

      // 确保触发UI更新
      if (typeof this.onZoomChange === 'function') {
        this.onZoomChange({
          zoomedArea: area,
          zoomState: this.zoomState,
          timestamp: Date.now()
        });
      } else {
        console.warn('onZoomChange回调不是函数，无法触发UI更新');
      }

      return this.zoomState; // 确保返回缩放状态
    } catch (error) {
      console.error('缩放区域时出错:', error);
      throw error; // 重新抛出错误
    }
  }

  resetZoom() {
    // 重置所有区域的缩放状态（包含所有区域）
    this.zoomState = {
      a: 1.0,
      b: 1.0,
      c: 1.0,
      f: 1.0,
      g: 1.0
    };
    console.log('所有区域缩放已重置为默认值');

    // 触发UI更新
    if (this.onZoomReset) {
      this.onZoomReset(this.zoomState);
    }

    return this.zoomState;
  }

  constructor() {
    // 初始化缩放状态和回调（包含所有区域）
    this.zoomState = {
      a: 1.0,
      b: 1.0,
      c: 1.0,
      f: 1.0,
      g: 1.0
    };

    // 设置默认回调
    this.onZoomChange = (state) => {
      console.log('默认zoom回调:', state);
      if (window.updateZoomState) {
        window.updateZoomState(state);
      }
    };

    this.onZoomReset = (state) => {
      console.log('默认zoom重置回调:', state);
      if (window.updateZoomState) {
        window.updateZoomState(state);
      }
    };

    // 24寸屏幕配置 (1920x1080分辨率)
    this.screenConfig = {
      diagonalInches: 24,
      resolution: { width: 1920, height: 1080 },
      ppi: 92, // 像素每英寸
      aoiRatios: {
        a: 0.2, // 左栏20%
        c: 0.6, // 中栏60%
        bf: 0.2, // 右栏20%
        g: 0    // 非任务区不参与面积归一化
      }
    };

    // 防抖状态
    this.confirmationState = {
      direct: 0,
      referential: 0,
      exploratory: 0,
      lastConfirmedType: null
    };

    // 默认阈值配置
    this.config = {
      windowSize: 5000, // 5秒窗口
      entropyThresholds: {
        low: 1.2,
        high: 1.8
      },
      coverageThresholds: {
        directMax: 2,
        referentialMin: 2,
        referentialMax: 3,
        exploratoryMin: 3
      },
      gazeDurationThresholds: {
        short: 200, // 毫秒
        long: 500   // 毫秒
      },
      saccadeThresholds: {
        // 基于24寸屏幕物理尺寸调整(约0.5-1.5英寸扫视)
        small: 50,  // ~0.5英寸
        medium: 150, // ~1.5英寸
        large: 300   // ~3英寸
      },
      confirmationWindows: 2 // 防抖需要连续2个窗口确认
    };

    // 当前窗口数据
    this.currentWindow = {
      startTime: null,
      gazeData: [],
      aoiStats: {
        a: { count: 0, duration: 0 },
        b: { count: 0, duration: 0 },
        c: { count: 0, duration: 0 },
        f: { count: 0, duration: 0 },
        g: { count: 0, duration: 0 }
      },
      saccadeAmplitudes: []
    };
  }


  /**
   * 添加新的注视点数据
   * @param {Object} data - 注视点数据
   * @param {number} data.x - 屏幕x坐标
   * @param {number} data.y - 屏幕y坐标
   * @param {string} data.aoi - 注视区域(A/B/C/F/G)
   * @param {number} data.duration - 注视持续时间(ms)
   * @param {number} timestamp - 时间戳
   * @returns {Object|null} 分类结果(经过防抖确认后)
   */
  addGazePoint(data, timestamp) {
    // 添加时间戳到数据中
    data.timestamp = timestamp;

    if (!this.currentWindow.startTime) {
      this.currentWindow.startTime = timestamp;
    }

    // 确定AOI区域(考虑24寸屏幕布局)
    if (!data.aoi) {
      data.aoi = this.determineAOI(data.x, data.y);
    }

    // 记录AOI统计
    if (this.currentWindow.aoiStats[data.aoi]) {
      this.currentWindow.aoiStats[data.aoi].count++;
      this.currentWindow.aoiStats[data.aoi].duration += data.duration;
    }

    // 记录扫视幅度(如果这是第二个及以后的注视点)
    if (this.currentWindow.gazeData.length > 0) {
      const lastValidPoint = this.currentWindow.gazeData
        .slice()
        .reverse()
        .find(g => g.timestamp > timestamp - 2000); // 只考虑2秒内的注视点

      if (lastValidPoint) {
        const amplitude = Math.sqrt(
          Math.pow(data.x - lastValidPoint.x, 2) +
          Math.pow(data.y - lastValidPoint.y, 2)
        );
        this.currentWindow.saccadeAmplitudes.push(amplitude);
      }
    }

    this.currentWindow.gazeData.push(data);
    // 严格5秒窗口控制
    const now = timestamp;
    if (!this.currentWindow.startTime) {
      this.currentWindow.startTime = now;
      return null; // 首次不分析
    }

    const windowDuration = now - this.currentWindow.startTime;
    if (windowDuration < this.config.windowSize) {
      console.log(`严格等待5秒: ${windowDuration / 1000}s/5s`);
      return null;
    }

    // 5秒窗口已满，执行分析
    console.log('5秒窗口已满，开始分析');
    const result = this.classifyUser();
    console.log('分类结果:', JSON.stringify(result, null, 2));

    // 完全重置窗口（不清除回调）
    this.currentWindow = {
      startTime: now, // 重置为新时间点
      gazeData: [],
      aoiStats: {
        a: { count: 0, duration: 0 },
        b: { count: 0, duration: 0 },
        c: { count: 0, duration: 0 },
        f: { count: 0, duration: 0 },
        g: { count: 0, duration: 0 }
      },
      saccadeAmplitudes: []
    };

    return result;
    // return null;
  }

  /**
   * 根据坐标确定AOI区域
   * @param {number} x - 屏幕x坐标
   * @param {number} y - 屏幕y坐标
   * @returns {string} AOI标识符(A/B/C/F/G)
   */
  determineAOI(x, y) {
    const screenWidth = this.screenConfig.resolution.width;
    const aWidth = screenWidth * this.screenConfig.aoiRatios.a;
    const cWidth = screenWidth * this.screenConfig.aoiRatios.c;

    if (x < aWidth) return 'a';
    if (x < aWidth + cWidth) return 'c';
    return y < this.screenConfig.resolution.height / 2 ? 'b' : 'f';
  }

  /**
   * 分类用户并返回结果(带防抖确认)
   * @returns {Object|null} 分类结果(经过防抖确认后)
   */
  classifyUser() {
    // 计算各AOI的注视占比（安全版）
    const totalGazeCount = Object.values(this.currentWindow.aoiStats)
      .reduce((sum, stat) => sum + (stat?.count || 0), 0) || 1; // 避免除以0

    const totalGazeDuration = Object.values(this.currentWindow.aoiStats)
      .reduce((sum, stat) => sum + (stat?.duration || 0), 0) || 1; // 避免除以0

    const aoiProportions = {};
    for (const [aoi, stat] of Object.entries(this.currentWindow.aoiStats)) {
      aoiProportions[aoi] = {
        countProportion: (stat?.count || 0) / totalGazeCount,
        durationProportion: (stat?.duration || 0) / totalGazeDuration,
        rawCount: stat?.count || 0,
        rawDuration: stat?.duration || 0
      };
    }
    console.log('AOI比例计算结果:', JSON.stringify(aoiProportions, null, 2));

    // 计算扫视幅度中位数
    const medianSaccade = this.calculateMedian(this.currentWindow.saccadeAmplitudes);

    // 计算AOI熵
    const entropy = this.calculateEntropy(
      Object.values(aoiProportions).map(p => p.countProportion)
    );

    // 计算覆盖的AOI数量
    const coverage = Object.values(aoiProportions)
      .filter(p => p.countProportion > 0.05).length;

    // 计算注视时长中位数
    const gazeDurations = this.currentWindow.gazeData.map(g => g.duration);
    const medianGazeDuration = this.calculateMedian(gazeDurations);

    // 计算面积归一化密度(d指标)
    const densityMetrics = {
      a: aoiProportions.a.countProportion / this.screenConfig.aoiRatios.a,
      c: aoiProportions.c.countProportion / this.screenConfig.aoiRatios.c,
      b: aoiProportions.b.countProportion / (this.screenConfig.aoiRatios.bf / 2),
      f: aoiProportions.f.countProportion / (this.screenConfig.aoiRatios.bf / 2)
    };

    // 分类逻辑
    let userType = 'unknown';
    // 1. 检查直接型(Direct) - 安全访问版
    const cProportion = JSON.stringify(aoiProportions.c.countProportion) || 0;
    const cDensity = JSON.stringify(densityMetrics.c) || 0;
    if (
      cProportion >= 0.2 && // 降低到20%
      cDensity > 0.3 && // 显著降低密度要求
      medianGazeDuration >= 10 // 区域C总注视时长至少1000ms(1秒)
    ) {
      console.log('满足直接型条件:', {
        cProportion,
        cDensity,
        gazeDuration: medianGazeDuration
      });
      userType = 'direct';
      console.log('检测到直接型用户:', {
        cProportion: aoiProportions.c.countProportion,
        density: densityMetrics.c,
        duration: medianGazeDuration,
        entropy: entropy,
        coverage: coverage
      });
    }
    // 2. 检查对照型(Referential) - 简化条件
    else if (
      (JSON.stringify(aoiProportions.c.countProportion) + JSON.stringify(aoiProportions.b.countProportion)) >= 0.5 &&
      Math.abs(JSON.stringify(densityMetrics.c) - JSON.stringify(densityMetrics.b)) < 0.8 &&
      medianGazeDuration >= 150 // 两区域合计至少1.5秒
    ) {
      userType = 'referential';
    }
    // 3. 检查探索型(Exploratory)
    else if (
      JSON.stringify(medianSaccade) >= JSON.stringify(this.config.saccadeThresholds.large) &&
      JSON.stringify(entropy) >= JSON.stringify(this.config.entropyThresholds.high) &&
      JSON.stringify(coverage) >= JSON.stringify(this.config.coverageThresholds.exploratoryMin) &&
      JSON.stringify(aoiProportions.g.countProportion) > 0.1 &&
      JSON.stringify(densityMetrics.c) < 1.5 && // 没有明显优势区域
      JSON.stringify(medianGazeDuration) < 1000 // 主要区域注视不足
    ) {
      userType = 'exploratory';
    }

    // 保存最后一次分类统计
    this.lastClassificationStats = {
      medianSaccade,
      entropy,
      coverage,
      medianGazeDuration,
      aoiProportions,
      densityMetrics,
      gazeCount: totalGazeCount
    };

    // 准备结果对象（增强版）
    const result = {
      userType: userType || 'unknown',
      zoomedArea: null,
      stats: {
        medianSaccade,
        entropy,
        coverage,
        medianGazeDuration,
        aoiProportions,
        densityMetrics,
        gazeCount: totalGazeCount,
        windowDuration: Date.now() - this.currentWindow.startTime
      },
      uiRecommendation: this.getUIRecommendation(userType),
      timestamp: new Date().toISOString(),
      // 调试信息
      _diagnostics: {
        cProportion: aoiProportions.c?.countProportion,
        cDuration: aoiProportions.c?.rawDuration,
        totalDuration: totalGazeDuration
      }
    };

    // 确保回调函数设置
    if (!this.onZoomChange) {
      this.onZoomChange = (state) => {
        console.log('Zoom状态变化:', state);
        // 确保UI能收到更新
        if (window.updateZoomState) {
          window.updateZoomState(state);
        } else {
          console.warn('window.updateZoomState 未定义，请确保UI监听器已设置');
        }
      };
      console.log('已设置默认zoom回调函数');
    }

    // 即使未分类也返回结果，但添加详细诊断信息
    if (userType !== 'unknown') {
      console.log('检测到用户类型:', userType, '详细统计:', {
        proportions: aoiProportions,
        saccade: medianSaccade,
        entropy: entropy,
        coverage: coverage,
        gazeDuration: medianGazeDuration
      });
      this.confirmationState.lastConfirmedType = userType;

      // 准确找出注视时长最长的有效区域
      const validAreas = ['a', 'b', 'c', 'f'];
      let maxDurationEntry = null;

      try {
        maxDurationEntry = Object.entries(this.currentWindow.aoiStats)
          .filter(([area]) => validAreas.includes(area))
          .reduce((a, b) => {
            if (!a[1] || !b[1]) return a; // 防止空数据
            return a[1].duration > b[1].duration ? a : b;
          });
      } catch (error) {
        console.error('计算注视时长时出错:', error);
      }

      if (maxDurationEntry && maxDurationEntry[1].duration > 0) {
        result.zoomedArea = maxDurationEntry[0];
        console.log(`将放大注视最久的区域: ${result.zoomedArea} (时长: ${maxDurationEntry[1].duration}ms)`);

        // 立即执行放大操作
        this.zoomArea(result.zoomedArea);
      } else {
        console.log('无显著注视区域，保持默认');
        this.resetZoom();
      }
    } else {
      // 详细诊断日志
      console.log('未分类诊断详情:', {
        thresholds: {
          direct: {
            cProportion: 0.2,
            density: 0.3,
            duration: 200
          },
          referential: {
            minCombined: 0.5,
            maxDensityDiff: 0.8,
            minDuration: 150
          }
        },
        actualValues: {
          cProportion: aoiProportions.c?.countProportion,
          bProportion: aoiProportions.b?.countProportion,
          cDensity: densityMetrics.c,
          bDensity: densityMetrics.b,
          gazeDuration: medianGazeDuration,
          densityDiff: Math.abs(densityMetrics.c - densityMetrics.b)
        },
        metConditions: {
          direct: aoiProportions.c?.countProportion >= 0.2 &&
            densityMetrics.c > 0.3 &&
            medianGazeDuration >= 200,
          referential: (aoiProportions.c.countProportion + aoiProportions.b.countProportion) >= 0.5 &&
            Math.abs(densityMetrics.c - densityMetrics.b) < 0.8 &&
            medianGazeDuration >= 150
        }
      });
      this.resetZoom();

      // 如果没有满足任何类型，返回注视时长最长的区域
      const validAreas = ['a', 'b', 'c', 'f'];
      const maxDurationEntry = Object.entries(this.currentWindow.aoiStats)
        .filter(([area]) => validAreas.includes(area))
        .reduce((a, b) => a[1].duration > b[1].duration ? a : b, [null, { duration: 0 }]);

      if (maxDurationEntry[0] && maxDurationEntry[1].duration > 0) {
        result.zoomedArea = maxDurationEntry[0];
        console.log(`自动选择注视最久的区域: ${result.zoomedArea} (时长: ${maxDurationEntry[1].duration}ms)`);
        this.zoomArea(result.zoomedArea);
      }
    }

    // 重置窗口数据
    this.resetWindow();
    for (const type in this.confirmationState) {
      this.confirmationState[type] = 0;
    }

    return result;
  }

  // 保留当前窗口数据继续累积
  // console.log('保持当前窗口继续累积数据');
  // return null;
  // }

  /**
   * 计算熵值
   * @param {Array<number>} proportions - 各AOI的注视比例数组
   * @returns {number} 熵值
   */
  calculateEntropy(proportions) {
    return -proportions.reduce((sum, p) => {
      return p > 0 ? sum + p * Math.log2(p) : sum;
    }, 0);
  }

  /**
   * 计算中位数
   * @param {Array<number>} values - 数值数组
   * @returns {number} 中位数
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  /**
   * 获取UI调整建议
   * @param {string} userType - 用户类型
   * @returns {Object} UI建议
   */
  getUIRecommendation(userType) {
    switch (userType) {
      case 'direct':
        return {
          layout: 'focus',
          description: '简化界面，突出代码编辑区',
          components: {
            taskPanel: { visible: true, collapsed: true },
            outputPanel: { visible: false }
          }
        };
      case 'referential':
        return {
          layout: 'balanced',
          description: '保持三栏布局，确保参考信息可见',
          components: {
            taskPanel: { visible: true, collapsed: false },
            outputPanel: { visible: true, split: 'vertical' }
          }
        };
      case 'exploratory':
        return {
          layout: 'guided',
          description: '提供更多引导和文档链接',
          components: {
            taskPanel: { visible: true, collapsed: false },
            outputPanel: { visible: true, split: 'horizontal' }
          }
        };
      default:
        return {
          layout: 'default',
          description: '保持当前UI布局',
          components: {}
        };
    }
  }

  /**
   * 重置当前窗口数据
   */
  resetWindow() {
    const newWindow = {
      startTime: null,
      gazeData: [],
      aoiStats: {
        a: { count: 0, duration: 0 },
        b: { count: 0, duration: 0 },
        c: { count: 0, duration: 0 },
        f: { count: 0, duration: 0 },
        g: { count: 0, duration: 0 }
      },
      saccadeAmplitudes: []
    };

    // 迁移未过期的数据
    if (this.currentWindow.gazeData.length > 0) {
      const now = Date.now();
      const validData = this.currentWindow.gazeData.filter(
        g => now - g.timestamp < this.config.windowSize
      );

      if (validData.length > 0) {
        newWindow.startTime = validData[0].timestamp;
        newWindow.gazeData = validData;

        // 重新计算统计
        validData.forEach(data => {
          if (newWindow.aoiStats[data.aoi]) {
            newWindow.aoiStats[data.aoi].count++;
            newWindow.aoiStats[data.aoi].duration += data.duration;
          }
        });
      }
    }

    this.currentWindow = newWindow;
    console.log('窗口已重置，保留未过期数据:', newWindow.gazeData.length);
  }
  /**
   * 获取最后一次分类结果
   * @returns {Object|null} 最后一次完整的分类结果
   */
  getLastClassification() {
    if (!this.confirmationState.lastConfirmedType) {
      return null;
    }

    return {
      userType: this.confirmationState.lastConfirmedType,
      timestamp: new Date().toISOString(),
      stats: this.lastClassificationStats || {}
    };
  }
}

// 导出单例实例
export const userClassificationService = new UserClassificationService();

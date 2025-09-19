<template>
  <div id="app">
    <!-- 添加摄像头视频显示 -->
    <video id="webgazerVideoFeed" style="position: fixed; top: 10px; left: 10px; z-index: 1000; display: none; border: 2px solid #2c3e50; border-radius: 8px;"></video>
    <div class="container">
      <div class="box box-a" ref="boxA">区域A</div>
      <div class="box box-b" ref="boxB">区域B</div>
      <div class="box box-c" ref="boxC">区域C</div>
    </div>
    <div class="stats">
      <p>注视统计 (5秒内):</p>
      <p>A区域: {{ gazeDuration.a }}ms</p>
      <p>B区域: {{ gazeDuration.b }}ms</p>
      <p>C区域: {{ gazeDuration.c }}ms</p>
      <p>F区域: {{ gazeDuration.f }}ms</p>
      <p>G区域: {{ gazeDuration.g }}ms</p>
      <p v-if="loading" style="color: #f39c12;">正在初始化眼动跟踪...</p>
    </div>

    <div class="user-type" :class="userType">
      <p v-if="userType === 'direct'">用户类型: 直接型 (Direct)</p>
      <p v-else-if="userType === 'referential'">用户类型: 对照型 (Referential)</p>
      <p v-else-if="userType === 'exploratory'">用户类型: 探索型 (Exploratory)</p>
      <p v-else>用户类型: 未确定</p>
    </div>

    <div class="stat-details" v-if="stats">
      <div class="stat-item">
        <span class="stat-label">扫视幅度:</span>
        <span>{{ stats.medianSaccade.toFixed(1) }}px</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">AOI熵:</span>
        <span>{{ stats.entropy.toFixed(2) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">覆盖区域:</span>
        <span>{{ stats.coverage }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">注视时长:</span>
        <span>{{ stats.medianGazeDuration.toFixed(1) }}ms</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">注视点数量:</span>
        <span>{{ stats.gazeCount }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { userClassificationService } from "./services/userClassificationService";
import { webgazerService } from "./services/webgazerService";

export default {
  name: "App",
  components: {},
  data() {
    return {
      gazeDuration: { a: 0, b: 0, c: 0, f: 0, g: 0 }, // 记录10秒内的注视总时长
      gazeStartTime: { a: null, b: null, c: null, f: null, g: null }, // 记录开始注视时间
      currentZoom: null,
      loading: false,
      gazeTimer: null,
      userType: null, // 当前用户类型
      userTypeHistory: [], // 用户类型历史记录
      stats: null, // 统计信息
    };
  },
  mounted() {
    // 添加调试信息
    console.log("App组件已挂载");

    // 设置缩放状态监听
    window.updateZoomState = (state) => {
      console.log("收到缩放状态更新:", state);
      this.$nextTick(() => {
        this.zoomArea(state.zoomedArea);
      });
    };

    if (this.setupEyeTracking) {
      this.setupEyeTracking();
    } else {
      console.error("setupEyeTracking方法未定义");
    }
  },
  beforeUnmount() {
    if (this.gazeTimer) clearInterval(this.gazeTimer);
    webgazer.clearGazeListener();
    webgazer.stopVideo();
    webgazer.stop();
  },
  methods: {
    async setupEyeTracking() {
      try {
        console.log("开始初始化眼动跟踪...");
        this.loading = true;

        // 使用webgazerService初始化
        await webgazerService.init();

        // 设置视频显示
        const video = document.getElementById("webgazerVideoFeed");
        video.style.display = "block";
        video.style.position = "fixed";
        video.style.top = "10px";
        video.style.left = "10px";
        video.style.zIndex = "1000";
        video.style.border = "2px solid #2c3e50";
        video.style.borderRadius = "8px";
        video.width = 320;
        video.height = 240;

        // 设置注视监听
        webgazer.setGazeListener((data, elapsedTime) => {
          if (data) {
            console.log("检测到注视点:", data);
            this.checkGazePosition(data.x, data.y);
            this.loading = false;

            // 只有在获取到眼动数据后才启动定时器
            if (!this.gazeTimer) {
              console.log("启动5秒统计定时器...");
              this.gazeTimer = setInterval(() => {
                console.log("5秒统计周期触发");
                this.determineZoomArea();
              }, 5000);
            }
          }
        });
      } catch (err) {
        console.error("眼动跟踪初始化失败:", err);
        this.showErrorNotification(err);
        this.loading = false;
      }
    },

    showErrorNotification(error) {
      this.$notify.error({
        title: "眼动跟踪初始化失败",
        message: `原因: ${error.message}`,
        duration: 0,
        showClose: true,
      });
    },
    checkGazePosition(x, y) {
      const now = Date.now();
      const boxes = {
        a: this.$refs.boxA.getBoundingClientRect(),
        b: this.$refs.boxB.getBoundingClientRect(),
        c: this.$refs.boxC.getBoundingClientRect(),
      };

      // 检查注视区域
      let currentAOI = "g"; // 默认为非任务区(G)
      for (const [area, box] of Object.entries(boxes)) {
        if (
          x >= box.left &&
          x <= box.right &&
          y >= box.top &&
          y <= box.bottom
        ) {
          currentAOI = area;
          break;
        }
      }

      // 记录注视数据
      if (currentAOI !== "g") {
        // 记录开始注视时间
        if (!this.gazeStartTime[currentAOI]) {
          this.gazeStartTime[currentAOI] = now;
          console.log(`开始注视区域 ${currentAOI}`);
        }

        // 累计注视时间
        const duration = now - (this.gazeStartTime[currentAOI] || now);
        this.gazeDuration[currentAOI] += duration;
        this.gazeStartTime[currentAOI] = now;
        console.log(
          `区域 ${currentAOI} 累计注视时间: ${this.gazeDuration[currentAOI]}ms`
        );

        // 添加分类数据并确保响应式更新
        const result = userClassificationService.addGazePoint(
          {
            x,
            y,
            aoi: currentAOI,
            duration,
          },
          now
        );

        if (result) {
          // alert("result的值是: " + JSON.stringify(result));
          // 使用Vue.set确保响应式更新
          this.$set(this, "userType", result.userType);
          this.$set(this, "stats", result.stats);
          this.userTypeHistory.push(result);
          console.log("用户分类结果:", {
            type: result.userType,
            stats: result.stats,
            zoomArea: result.zoomedArea,
          });

          // 强制更新UI
          this.$forceUpdate();
        }
      } else {
        // 处理非任务区注视
        const result = userClassificationService.addGazePoint(
          {
            x,
            y,
            aoi: "g",
            duration: 100, // 默认非任务区注视时长
          },
          now
        );

        if (result) {
          this.userType = result.userType;
          this.stats = result.stats;
          this.userTypeHistory.push(result);
          console.log("用户分类结果:", result);
        }
      }

      // 离开区域时重置计时
      for (const area of ["a", "b", "c", "f"]) {
        if (currentAOI !== area && this.gazeStartTime[area]) {
          console.log(`离开区域 ${area}`);
          this.gazeStartTime[area] = null;
        }
      }
    },
    determineZoomArea() {
      console.log("5秒统计周期结束，开始分析注视数据");
      // 从服务获取最新分类结果
      const result = userClassificationService.getLastClassification();

      if (result) {
        this.$set(this, "userType", result.userType);
        this.$set(this, "stats", result.stats);

        // 根据用户类型决定放大策略
        if (result.userType === "direct") {
          this.zoomArea("c");
        } else if (result.userType === "referential") {
          const maxArea = Object.entries(this.gazeDuration).reduce((a, b) =>
            a[1] > b[1] ? a : b
          )[0];
          if (this.gazeDuration[maxArea] > 0) {
            this.zoomArea(maxArea);
          }
        } else {
          userClassificationService.resetZoom();
        }
      }
      //

      // 重置统计
      this.gazeDuration = { a: 0, b: 0, c: 0, f: 0, g: 0 };
      console.log("已重置注视时间统计");
    },
    zoomArea(area) {
      if (!area) {
        console.log("重置所有区域缩放");
        this.resetAllZoom();
        return;
      }

      console.log(`准备放大区域 ${area}`);

      // 重置所有区域样式
      this.resetAllZoom();

      // 放大指定区域
      const box = this.$refs[`box${area.toUpperCase()}`];
      if (box) {
        box.style.transform = "scale(1.5)";
        box.style.zIndex = "10"; // 确保放大区域在最上层
        box.style.transition = "transform 0.3s ease";
        console.log(`已放大区域 ${area}`);
        this.currentZoom = area;
      } else {
        console.error(`找不到区域 ${area} 的DOM元素`);
      }

      // 重置计时
      this.gazeStartTime[area] = null;
    },

    resetAllZoom() {
      ["A", "B", "C"].forEach((area) => {
        const box = this.$refs[`box${area}`];
        if (box) {
          box.style.transform = "";
          box.style.zIndex = "";
        }
      });
      this.currentZoom = null;
    },
  },
};
</script>
<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}

.container {
  display: flex;
  justify-content: space-around;
  margin-bottom: 20px;
}

.box {
  width: 30%;
  height: 200px;
  border: 2px solid #2c3e50;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: bold;
  transition: transform 0.3s ease;
}

.box-a {
  background-color: #f8d7da;
}

.box-b {
  background-color: #d1e7dd;
}

.box-c {
  background-color: #cfe2ff;
}

.stats {
  margin: 20px 0;
  padding: 10px;
  background-color: #f8f9fa;
  border-radius: 8px;
}

.user-type {
  margin-top: 20px;
  padding: 15px;
  border-radius: 8px;
  font-weight: bold;
  text-align: center;
}

.user-type.direct {
  background-color: #d4edda;
  color: #155724;
}

.user-type.referential {
  background-color: #fff3cd;
  color: #856404;
}

.user-type.exploratory {
  background-color: #f8d7da;
  color: #721c24;
}

.user-type.unknown {
  background-color: #e2e3e5;
  color: #383d41;
}

.stat-details {
  margin-top: 10px;
  padding: 10px;
  background-color: #e9ecef;
  border-radius: 5px;
  font-size: 14px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
}

.stat-label {
  font-weight: bold;
}

.webgazerVideoContainer {
  position: fixed;
  top: 10px;
  left: 10px;
  width: 200px;
  height: 150px;
  border: 2px solid #2c3e50;
  border-radius: 8px;
  z-index: 1000;
}

.webgazerVideoContainer video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>

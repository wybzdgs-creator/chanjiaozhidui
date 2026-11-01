/* 「产教智对」前端应用 —— Vue 3 Options API + ECharts
   无构建步骤，直接由 FastAPI 静态托管。 */
(function () {
  'use strict';

  const { createApp } = Vue;

  // 图表色板（已通过 dataviz 校验：蓝/橙/青，浅色模式）
  const C = {
    blue: '#2a78d6',
    orange: '#eb6834',
    aqua: '#1baf7a',
    blueLight: '#86b6ef',
    blueDark: '#0d366b',
    ink: '#475467',
    ink2: '#667085',
    grid: '#eef2f7',
    axis: '#e4e9f0',
    red: '#d03b3b',
    amber: '#fab219',
    green: '#0ca30c',
  };
  const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  const textStyle = { fontFamily: FONT, color: C.ink, fontSize: 11 };
  const axisLabel = { color: C.ink2, fontSize: 10.5, fontFamily: FONT };
  const tooltip = {
    backgroundColor: '#fff',
    borderColor: 'rgba(16,24,40,.08)',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#101828', fontSize: 11.5, fontFamily: FONT },
    extraCssText: 'box-shadow:0 6px 24px rgba(16,24,40,.12);border-radius:10px;',
  };
  const grid = { left: 6, right: 12, top: 10, bottom: 6, containLabel: true };

  const NAV = [
    { key: 'dashboard', no: '00', label: '工作台', sub: '总览与快捷入口' },
    { key: 'data', no: '01', label: '数据中心', sub: '招聘 / 方案 / 就业' },
    { key: 'analysis', no: '02', label: '供需诊断', sub: '技能缺口量化' },
    { key: 'plan', no: '03', label: '方案生成', sub: '课程与规模调整' },
    { key: 'simulation', no: '04', label: '效果模拟', sub: '四年情景推演' },
    { key: 'risk', no: '05', label: '风险评估', sub: '识别与应对' },
    { key: 'report', no: '06', label: '决策报告', sub: 'Excel / PDF 导出' },
  ];

  async function api(path, opts) {
    const base = (window.__API_BASE__ || '').replace(/\/$/, '');
    const res = await fetch(base + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      const detail = data && data.detail;
      throw new Error(typeof detail === 'string' ? detail : '请求失败（' + res.status + '）');
    }
    return data;
  }

  const ChartBox = {
    props: {
      option: { type: Object, required: true },
      height: { type: String, default: '320px' },
    },
    template: '<div class="chart" :style="{ height: height }"></div>',
    mounted() {
      this.chart = echarts.init(this.$el);
      this.chart.setOption(this.option);
      this.observer = new ResizeObserver(() => { if (this.chart) this.chart.resize(); });
      this.observer.observe(this.$el);
    },
    watch: {
      option: {
        deep: true,
        handler(v) { if (this.chart) this.chart.setOption(v, true); },
      },
    },
    beforeUnmount() {
      if (this.observer) this.observer.disconnect();
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
  };

  const app = createApp({
    data() {
      const now = new Date();
      return {
        logged: false,
        loginUser: 'admin',
        loginPass: '123456',
        loginErr: '',
        view: 'dashboard',
        navItems: NAV,

        meta: { majors: [], counts: {}, skills: 0, llm: { enabled: false } },
        counts: { postings: 0, programs: 0, courses: 0, employment: 0 },
        major: '计算机科学与技术',
        newMajor: '',
        clusterStats: [],
        postingsPreview: [],
        programCourses: [],
        programCredits: 0,

        analysis: null,
        plan: null,
        sim: null,
        risk: null,

        constraints: { target_match: 65, max_new_courses: 6, max_credit_delta_pct: 12 },

        busy: { postings: false, program: false, employment: false, analyze: false, plan: false, sim: false, risk: false },
        uploadMsg: { postings: '', program: '', employment: '' },
        toast: '',
        toastTimer: null,
        reportTime: now.toLocaleString('zh-CN', { hour12: false }),
      };
    },

    computed: {
      programPractice() {
        const total = this.programCourses.reduce((a, c) => a + Number(c.credits || 0), 0);
        if (!total) return 0;
        const practice = this.programCourses.filter(c => c.type === '实践')
          .reduce((a, c) => a + Number(c.credits || 0), 0);
        return Math.round((practice / total) * 1000) / 10;
      },
      currentTitle() {
        const n = this.navItems.find(x => x.key === this.view);
        return n ? n.label : '工作台';
      },
      currentSub() {
        const n = this.navItems.find(x => x.key === this.view);
        return n ? n.sub : '';
      },
      gapCount() {
        if (!this.analysis) return 0;
        return this.analysis.skills.filter(s => s.gap >= 8).length;
      },
      reportReady() {
        return !!(this.analysis && this.plan && this.sim && this.risk);
      },
      llmEnabled() {
        return !!(this.meta.llm && this.meta.llm.enabled);
      },
      busyText() {
        if (this.busy.analyze) return '正在抽取岗位技能并比对培养方案…';
        if (this.busy.plan) return '正在生成方案并校验约束…';
        if (this.busy.sim) return '正在推演四年效果…';
        if (this.busy.risk) return '正在识别落地风险…';
        return '处理中…';
      },
      scenarioColors() {
        return [C.blueLight, C.blue, C.blueDark];
      },

      clusterOption() {
        const rows = (this.analysis && this.analysis.clusters && this.analysis.clusters.length)
          ? this.analysis.clusters
          : this.clusterStats;
        if (!rows.length) return { title: { text: '暂无岗位数据', left: 'center', top: 'middle', textStyle: { color: C.ink2, fontSize: 12, fontWeight: 400 } } };
        const sorted = rows.slice().sort((a, b) => a.count - b.count);
        return {
          grid: { left: 8, right: 30, top: 8, bottom: 4, containLabel: true },
          tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => p[0].name + '<br/>岗位数：<b>' + p[0].value + '</b> 条' },
          xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: axisLabel },
          yAxis: { type: 'category', data: sorted.map(r => r.name), axisLabel: { ...axisLabel, color: C.ink }, axisLine: { show: false }, axisTick: { show: false } },
          series: [{
            type: 'bar', data: sorted.map(r => r.count), barWidth: 12,
            itemStyle: { color: C.blue, borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: C.ink2, fontSize: 10.5, fontFamily: FONT },
          }],
        };
      },

      demandOption() {
        if (!this.analysis) return {};
        const rows = this.analysis.skills.slice(0, 12).slice().reverse();
        return {
          grid: { left: 8, right: 46, top: 30, bottom: 4, containLabel: true },
          tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
          legend: { show: false },
          xAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: C.grid } }, axisLabel: axisLabel },
          yAxis: {
            type: 'category', data: rows.map(s => s.name),
            axisLabel: { ...axisLabel, color: C.ink, width: 92, overflow: 'truncate' },
            axisLine: { show: false }, axisTick: { show: false },
          },
          series: [
            {
              name: '市场需求', type: 'bar', barWidth: 8, barGap: '30%',
              data: rows.map(s => s.demand),
              itemStyle: { color: C.blue, borderRadius: [0, 4, 4, 0] },
            },
            {
              name: '培养覆盖', type: 'bar', barWidth: 8,
              data: rows.map(s => s.coverage),
              itemStyle: { color: C.orange, borderRadius: [0, 4, 4, 0] },
            },
          ],
        };
      },

      radarOption() {
        if (!this.analysis) return {};
        const rows = this.analysis.categories.slice(0, 6);
        return {
          tooltip: { ...tooltip, trigger: 'item' },
          legend: {
            bottom: 0, itemWidth: 10, itemHeight: 10, itemGap: 18,
            textStyle: { ...axisLabel, color: C.ink2 },
          },
          radar: {
            center: ['50%', '48%'], radius: '62%',
            indicator: rows.map(r => ({ name: r.cat, max: 100 })),
            axisName: { color: C.ink, fontSize: 11, fontFamily: FONT },
            splitLine: { lineStyle: { color: C.axis } },
            splitArea: { areaStyle: { color: ['#fff', '#fafbfd'] } },
            axisLine: { lineStyle: { color: C.axis } },
          },
          series: [{
            type: 'radar', symbolSize: 6,
            data: [
              { name: '市场需求', value: rows.map(r => r.demand), lineStyle: { width: 2, color: C.blue }, itemStyle: { color: C.blue }, areaStyle: { color: 'rgba(42,120,214,.12)' } },
              { name: '培养覆盖', value: rows.map(r => r.coverage), lineStyle: { width: 2, color: C.orange }, itemStyle: { color: C.orange }, areaStyle: { color: 'rgba(235,104,52,.12)' } },
            ],
          }],
        };
      },

      timelineOption() {
        if (!this.sim) return {};
        const years = this.sim.scenarios[0].timeline.map(t => String(t.year));
        return {
          grid: { left: 6, right: 54, top: 34, bottom: 4, containLabel: true },
          tooltip: {
            ...tooltip, trigger: 'axis',
            formatter: ps => {
              let s = ps[0].axisValue + ' 届<br/>';
              ps.forEach(p => { s += p.marker + p.seriesName + '：<b>' + p.value + '</b> 分<br/>'; });
              return s;
            },
          },
          xAxis: { type: 'category', boundaryGap: false, data: years, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: axisLabel },
          yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: C.grid } }, axisLabel: axisLabel },
          series: this.sim.scenarios.map((sc, i) => ({
            name: sc.name, type: 'line', smooth: false,
            data: sc.timeline.map(t => t.match),
            symbol: 'circle', symbolSize: 7,
            lineStyle: { width: 2, color: this.scenarioColors[i] },
            itemStyle: { color: this.scenarioColors[i], borderWidth: 2, borderColor: '#fff' },
            emphasis: { focus: 'series' },
            labelLayout: { hideOverlap: true },
            endLabel: { show: true, formatter: sc.name, color: C.ink2, fontSize: 10, fontFamily: FONT, distance: 4 },
          })),
        };
      },

      employmentOption() {
        if (!this.sim) return {};
        const rows = this.sim.scenarios;
        return {
          grid: { left: 6, right: 20, top: 24, bottom: 4, containLabel: true },
          tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => p[0].name + '情景<br/>就业率：<b>' + p[0].value + '%</b>' },
          xAxis: { type: 'category', data: rows.map(r => r.name), axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { ...axisLabel, color: C.ink, fontSize: 11 } },
          yAxis: { type: 'value', min: 50, max: 100, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { ...axisLabel, formatter: '{value}%' } },
          series: [{
            type: 'bar', data: rows.map(r => r.employment), barWidth: 42,
            itemStyle: { color: C.blue, borderRadius: [4, 4, 0, 0] },
            label: { show: true, position: 'top', color: C.ink2, fontSize: 11, fontFamily: FONT, formatter: '{c}%' },
          }],
        };
      },

      riskOption() {
        if (!this.risk) return {};
        const colorOf = l => (l === '高' ? C.red : (l === '中' ? C.amber : C.green));
        const data = this.risk.risks.map(r => ({
          name: r.name,
          value: [Math.round((r.probability <= 1 ? r.probability * 100 : r.probability)), r.impact],
          itemStyle: { color: colorOf(r.level), borderColor: '#fff', borderWidth: 2 },
        }));
        return {
          grid: { left: 6, right: 30, top: 30, bottom: 30, containLabel: true },
          tooltip: {
            ...tooltip, trigger: 'item',
            formatter: p => p.name + '<br/>发生概率：<b>' + p.value[0] + '%</b><br/>影响程度：<b>' + p.value[1] + '/5</b>',
          },
          xAxis: {
            type: 'value', min: 0, max: 100, name: '发生概率（%）',
            nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: C.ink2, fontSize: 10.5, fontFamily: FONT },
            splitLine: { lineStyle: { color: C.grid } }, axisLabel: axisLabel,
          },
          yAxis: {
            type: 'value', min: 0, max: 5, name: '影响程度',
            nameTextStyle: { color: C.ink2, fontSize: 10.5, fontFamily: FONT },
            splitLine: { lineStyle: { color: C.grid } }, axisLabel: axisLabel,
          },
          series: [{
            type: 'scatter', data,
            symbolSize: v => 12 + v[1] * 3.6,
            label: { show: true, formatter: '{b}', position: 'right', color: C.ink, fontSize: 10.5, fontFamily: FONT, distance: 6 },
            labelLayout: { hideOverlap: true },
            emphasis: { scale: 1.15 },
            markLine: {
              silent: true, symbol: 'none',
              lineStyle: { color: '#c3ccd9', type: 'dashed', width: 1 },
              label: { show: false },
              data: [{ xAxis: 50 }, { yAxis: 3 }],
            },
          }],
        };
      },
    },

    methods: {
      async init() {
        try {
          const meta = await api('/api/meta');
          this.meta = meta;
          if (meta.counts) this.counts = meta.counts;
          if (meta.majors && meta.majors.length) {
            this.major = meta.majors.includes(this.major) ? this.major : meta.majors[0];
          }
        } catch (e) {
          this.showToast('无法连接后端服务：' + e.message);
        }
        await Promise.all([this.loadProgram(), this.loadPreview(), this.loadClusterStats()]);
      },

      doLogin() {
        this.loginErr = '';
        if (!this.loginUser.trim() || !this.loginPass.trim()) {
          this.loginErr = '请输入账号和密码（演示环境任意非空内容即可）';
          return;
        }
        this.logged = true;
        this.$nextTick(() => { this.toast = ''; });
      },

      go(view) {
        this.view = view;
        if (view === 'report') this.reportTime = new Date().toLocaleString('zh-CN', { hour12: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },

      showToast(msg) {
        this.toast = msg;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { this.toast = ''; }, 3200);
      },

      resetFlow() {
        this.analysis = null;
        this.plan = null;
        this.sim = null;
        this.risk = null;
      },

      async loadProgram() {
        try {
          const data = await api('/api/program?major=' + encodeURIComponent(this.major));
          this.programCourses = data.courses || [];
          this.programCredits = data.total_credits || 0;
        } catch (e) {
          this.programCourses = [];
          this.programCredits = 0;
        }
      },

      async loadPreview() {
        try {
          const data = await api('/api/postings?limit=10');
          this.postingsPreview = data.items || [];
          if (data.total != null) this.counts.postings = data.total;
        } catch (e) { /* ignore */ }
      },

      async loadClusterStats() {
        try {
          const data = await api('/api/postings?limit=1');
          this.clusterStats = data.clusters || [];
        } catch (e) { /* ignore */ }
      },

      async onMajorChange() {
        this.resetFlow();
        await this.loadProgram();
        this.showToast('已切换到「' + this.major + '」');
      },

      async runAnalysis() {
        if (this.busy.analyze) return;
        this.busy.analyze = true;
        try {
          const a = await api('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ major: this.major }),
          });
          this.analysis = a;
          this.plan = null; this.sim = null; this.risk = null;
          this.view = 'analysis';
          window.scrollTo({ top: 0, behavior: 'smooth' });
          this.showToast('供需诊断完成：匹配度 ' + a.match_score + ' 分');
        } catch (e) {
          this.showToast(e.message);
        } finally {
          this.busy.analyze = false;
        }
      },

      async makePlan() {
        if (!this.analysis) { this.showToast('请先完成供需诊断'); return; }
        if (this.busy.plan) return;
        this.busy.plan = true;
        try {
          const plan = await api('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run_id: this.analysis.run_id, constraints: this.constraints }),
          });
          this.plan = plan;
          this.sim = null; this.risk = null;
          this.showToast('方案已生成：匹配度 ' + plan.evaluation.match_before + ' → ' + plan.evaluation.match_after);
        } catch (e) {
          this.showToast(e.message);
        } finally {
          this.busy.plan = false;
        }
      },

      async runSimulation() {
        if (!this.plan || !this.analysis) { this.showToast('请先生成调整方案'); return; }
        if (this.busy.sim) return;
        this.busy.sim = true;
        try {
          const sim = await api('/api/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run_id: this.analysis.run_id, plan_id: this.plan.plan_id }),
          });
          this.sim = sim;
          this.risk = null;
          this.view = 'simulation';
          window.scrollTo({ top: 0, behavior: 'smooth' });
          this.showToast('效果模拟完成');
        } catch (e) {
          this.showToast(e.message);
        } finally {
          this.busy.sim = false;
        }
      },

      async runRisk() {
        if (!this.sim || !this.plan || !this.analysis) { this.showToast('请先完成效果模拟'); return; }
        if (this.busy.risk) return;
        this.busy.risk = true;
        try {
          const risk = await api('/api/risk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run_id: this.analysis.run_id, plan_id: this.plan.plan_id, sim_id: this.sim.sim_id }),
          });
          this.risk = risk;
          this.view = 'risk';
          window.scrollTo({ top: 0, behavior: 'smooth' });
          this.showToast('风险识别完成，共 ' + risk.risks.length + ' 项');
        } catch (e) {
          this.showToast(e.message);
        } finally {
          this.busy.risk = false;
        }
      },

      async exportExcel() {
        if (!this.reportReady) { this.showToast('请先完成诊断、方案、模拟与风险四个环节'); return; }
        try {
          const r = await api('/api/export/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              run_id: this.analysis.run_id,
              plan_id: this.plan.plan_id,
              sim_id: this.sim.sim_id,
              risk_id: this.risk.risk_id,
            }),
          });
          const a = document.createElement('a');
          a.href = r.url;
          a.download = r.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          this.showToast('报告已导出：' + r.filename);
        } catch (e) {
          this.showToast(e.message);
        }
      },

      printReport() {
        this.reportTime = new Date().toLocaleString('zh-CN', { hour12: false });
        this.view = 'report';
        setTimeout(() => { window.print(); }, 260);
      },

      probPct(r) {
        const p = Number(r.probability || 0);
        return Math.round(p <= 1 ? p * 100 : p);
      },

      riskCount(level) {
        if (!this.risk) return 0;
        return this.risk.risks.filter(r => r.level === level).length;
      },

      actionTypeName(type) {
        return {
          add_course: '新增课程',
          adjust_hours: '调整学时',
          remove_course: '优化置换',
          direction: '方向建设',
          enrollment: '招生规模',
        }[type] || type;
      },

      actionTagClass(type) {
        return {
          add_course: 'blue',
          adjust_hours: 'orange',
          remove_course: 'gray',
          direction: 'purple',
          enrollment: 'green',
        }[type] || 'gray';
      },

      async uploadPostings(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        this.busy.postings = true;
        this.uploadMsg.postings = '';
        try {
          const fd = new FormData();
          fd.append('file', f);
          const r = await api('/api/upload/postings', { method: 'POST', body: fd });
          this.uploadMsg.postings = '已导入 ' + r.imported + ' 条岗位';
          this.counts = r.counts || this.counts;
          this.resetFlow();
          await Promise.all([this.loadPreview(), this.loadClusterStats()]);
          this.showToast('招聘数据导入成功，共 ' + r.imported + ' 条');
        } catch (err) {
          this.uploadMsg.postings = err.message;
          this.showToast(err.message);
        } finally {
          this.busy.postings = false;
          e.target.value = '';
        }
      },

      async uploadProgram(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const targetMajor = (this.newMajor || '').trim() || this.major;
        this.busy.program = true;
        this.uploadMsg.program = '';
        try {
          const fd = new FormData();
          fd.append('file', f);
          const r = await api('/api/upload/program?major=' + encodeURIComponent(targetMajor), { method: 'POST', body: fd });
          this.uploadMsg.program = '已导入 ' + r.courses + ' 门课程';
          this.counts = r.counts || this.counts;
          this.resetFlow();
          if (!this.meta.majors.includes(targetMajor)) {
            this.meta.majors = this.meta.majors.concat([targetMajor]);
          }
          this.major = targetMajor;
          this.newMajor = '';
          await this.loadProgram();
          this.showToast('培养方案导入成功：' + targetMajor + '，共 ' + r.courses + ' 门课程');
        } catch (err) {
          this.uploadMsg.program = err.message;
          this.showToast(err.message);
        } finally {
          this.busy.program = false;
          e.target.value = '';
        }
      },

      async uploadEmployment(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        this.busy.employment = true;
        this.uploadMsg.employment = '';
        try {
          const fd = new FormData();
          fd.append('file', f);
          const r = await api('/api/upload/employment?major=' + encodeURIComponent(this.major), { method: 'POST', body: fd });
          this.uploadMsg.employment = '已导入 ' + r.imported + ' 个年度';
          this.resetFlow();
          this.showToast('就业数据导入成功');
        } catch (err) {
          this.uploadMsg.employment = err.message;
          this.showToast(err.message);
        } finally {
          this.busy.employment = false;
          e.target.value = '';
        }
      },
    },

    mounted() {
      this.init();
    },
  });

  app.component('chart-box', ChartBox);
  app.mount('#app');
})();

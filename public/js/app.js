/* public/js/app.js  (ESM)  Final - 完整版（修复偏见维度解析） */
const $ = s => document.querySelector(s);
const url = '/api/analyze'; // 更新API端点

let radarChart; 
let isAnalyzing = false; 
const COOL_DOWN = 1200;
const ui = { 
  input: $('#urlInput'), 
  btn: $('#analyzeBtn'), 
  progress: $('#progress'), 
  summary: $('#summary'), 
  fourDim: $('#fourDim'), 
  results: $('#results'), 
  fact: $('#factList'), 
  opinion: $('#opinionList'), 
  bias: $('#biasList'), 
  pub: $('#pubAdvice'), 
  pr: $('#prAdvice'), 
  radarEl: $('#radar'), 
  radarTgl: $('#radarToggle') 
};

/* ===== 浏览器 LRU 48 h ===== */
const LRU = new Map(); 
const LRU_TTL = 48 * 3600 * 1000;
async function hash(str) { 
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); 
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); 
}
async function getCache(content, title) { 
  const key = await hash(content + title); 
  const hit = LRU.get(key); 
  if (hit && Date.now() - hit.ts < LRU_TTL) return hit.report; 
  return null; 
}
async function setCache(content, title, report) { 
  const key = await hash(content + title); 
  LRU.set(key, { ts: Date.now(), report }); 
  if (LRU.size > 2000) LRU.delete(LRU.keys().next().value); 
}

/* 英文词典校正 - 异步加载，不阻塞其他功能 */
let enEmoDict = {};
let enEmoDictLoaded = false;

// 异步加载情感词典，不阻塞页面初始化
async function loadEmotionDict() {
  try {
    const response = await fetch('/dict/en-emotionDict.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    enEmoDict = data.reduce((acc, item) => {
      acc[item.word] = { intensity: item.intensity, polarity: item.polarity };
      return acc;
    }, {});
    
    console.log('情感词典加载完成，共', Object.keys(enEmoDict).length, '个词条');
    enEmoDictLoaded = true;
  } catch (err) {
    console.error('情感词典加载失败:', err);
    // 即使词典加载失败，也要继续运行，只是不使用情感分析功能
    enEmoDictLoaded = false;
  }
}

// 启动词典加载
loadEmotionDict();

function correctEmotionEN(rawEmo, text) { 
  // 如果词典未加载完成，直接返回原始值
  if (!enEmoDictLoaded || !text) return rawEmo; 
  const tokens = text.toLowerCase().match(/\b[\w']+\b/g) || []; 
  let maxPhrase = 0; 
  for (let n = 1; n <= 3; n++) { 
    for (let i = 0; i <= tokens.length - n; i++) { 
      const w = tokens.slice(i, i + n).join(' '); 
      if (enEmoDict[w]) maxPhrase = Math.max(maxPhrase, enEmoDict[w].intensity); 
    } 
  } 
  return Math.max(rawEmo, maxPhrase); 
}

// 显示进度条
function showProgress() {
  if (ui.progress) ui.progress.classList.remove('hidden');
  if (ui.summary) ui.summary.classList.add('hidden');
  if (ui.fourDim) ui.fourDim.classList.add('hidden');
  if (ui.results) ui.results.classList.add('hidden');
  const pctElement = document.getElementById('pct');
  const progressInner = document.getElementById('progressInner');
  if (pctElement) pctElement.textContent = '0';
  if (progressInner) progressInner.style.width = '0%';
}

// 隐藏进度条
function hideProgress() {
  if (ui.progress) ui.progress.classList.add('hidden');
}

// 获取网页内容的函数（简化版）
async function fetchContent(input) {
  // 如果输入是URL，则提取内容，否则直接返回输入内容
  if (input.startsWith('http')) {
    // 这里应该有获取网页内容的逻辑，但简化为返回输入
    return { content: input, title: 'Web Page' };
  } else {
    return { content: input, title: 'User Input' };
  }
}

// 解析API返回的结果 - 修复偏见维度解析
function parseResult(resultText) {
  try {
    console.log('开始解析结果:', resultText);
    
    // 初始化解析结果
    const parsed = {
      credibility: 0,
      facts: [],
      opinions: [],
      bias: [],
      publisherAdvice: '',
      prReply: '',
      summary: '',
      dimensions: { ts: 0, fd: 0, eb: 0, cs: 0 }
    };

    // 检查是否包含标准格式标记
    const hasStandardFormat = resultText.includes('Credibility:') && 
                             (resultText.includes('<fact>') || resultText.includes('<opinion>'));
    
    if (hasStandardFormat) {
      // 处理标准格式
      console.log('检测到标准格式');
      
      // 解析可信度
      const credibilityMatch = resultText.match(/Credibility:\s*(\d+(?:\.\d+)?)\/10/i);
      if (credibilityMatch) {
        parsed.credibility = parseFloat(credibilityMatch[1]);
      }

      // 解析事实
      const factMatches = resultText.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<fact>(.*?)<\/fact>/gs);
      if (factMatches) {
        parsed.facts = factMatches.map(fact => {
          const confMatch = fact.match(/conf:\s*(\d+\.?\d+)/);
          const contentMatch = fact.match(/<fact>(.*?)<\/fact>/s);
          const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
          const content = contentMatch ? contentMatch[1].trim() : fact.replace(/<\/?fact>/g, '').trim();
          return { content, confidence };
        });
      }

      // 解析观点
      const opinionMatches = resultText.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<opinion>(.*?)<\/opinion>/gs);
      if (opinionMatches) {
        parsed.opinions = opinionMatches.map(op => {
          const confMatch = op.match(/conf:\s*(\d+\.?\d+)/);
          const contentMatch = op.match(/<opinion>(.*?)<\/opinion>/s);
          const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
          const content = contentMatch ? contentMatch[1].trim() : op.replace(/<\/?opinion>/g, '').trim();
          return { content, confidence };
        });
      }

      // 解析偏见 - 专门处理偏见的五个维度格式
      const biasMatch = resultText.match(/Bias:\s*(.*?)(?=\n\n|$|\nPub:)/);
      if (biasMatch) {
        const biasText = biasMatch[1].trim();
        
        // 解析偏见的五个维度
        const biasComponents = [];
        
        // 1. Emotional words (bias.emotional) - 攻击/贬义情感词数量
        const emotionalMatch = biasText.match(/-E:N\s+conf:\s*(\d+\.?\d+)/);
        if (emotionalMatch) {
          biasComponents.push(`Emotional words: ${emotionalMatch[1]} (Attack/derogatory emotional words count)`);
        }
        
        // 2. Binary opposition (bias.binary) - 敌对标签数量
        const binaryMatch = biasText.match(/-B:N/);
        if (binaryMatch) {
          biasComponents.push('Binary opposition: Present (Hostile labels count)');
        }
        
        // 3. Mind-reading (bias.mind) - 揣测动机数量
        const mindMatch = biasText.match(/-M:N/);
        if (mindMatch) {
          biasComponents.push('Mind-reading: Present (Assuming motives/intents count)');
        }
        
        // 4. Logical fallacy (bias.fallacy) - 逻辑谬误数量
        const fallacyMatch = biasText.match(/-F:N/);
        if (fallacyMatch) {
          biasComponents.push('Logical fallacy: Present (Classic fallacies count)');
        }
        
        // 5. Overall stance (bias.stance) - 总体立场
        const stanceMatch = biasText.match(/-Stance:([^-\n]+)/);
        if (stanceMatch) {
          const stance = stanceMatch[1].trim();
          biasComponents.push(`Overall stance: ${stance} (neutral/leaning/critical + percentage)`);
        }
        
        if (biasComponents.length > 0) {
          parsed.bias = biasComponents;
        } else {
          parsed.bias = [biasText];
        }
      }

      // 解析发布商建议和PR回复
      const pubMatch = resultText.match(/Pub:\s*(.*?)(?=\nPR:|$)/i);
      if (pubMatch) {
        parsed.publisherAdvice = pubMatch[1].replace(/\(≤\d+w\)/g, '').trim();
      }
      
      const prMatch = resultText.match(/PR:\s*(.*?)(?=\nSum:|$)/i);
      if (prMatch) {
        parsed.prReply = prMatch[1].replace(/\(≤\d+w\)/g, '').trim();
      }

      // 解析摘要
      const sumMatch = resultText.match(/Sum:\s*(.*?)(?=\n|$)/i);
      if (sumMatch) {
        parsed.summary = sumMatch[1].replace(/\(≤\d+w\)/g, '').trim();
      } else {
        // 如果没有Sum，使用Text行
        const textMatch = resultText.match(/Text:\s*(.*?)(?=\n$|$)/s);
        if (textMatch) {
          parsed.summary = textMatch[1].trim();
        }
      }

    } else {
      // 处理自然语言格式（KIMI的解释性回复）
      console.log('检测到自然语言格式');
      
      // 先检查是否包含偏见指标格式
      const biasPattern = /-E:N\s+conf:\s*\d+\.?\d+\s+-B:N\s+-M:N\s+-F:N\s+-Stance:[^-\n]+/;
      if (biasPattern.test(resultText)) {
        console.log('检测到偏见指标格式');
        // 提取偏见指标
        const biasText = resultText.match(biasPattern)?.[0];
        if (biasText) {
          const biasComponents = [];
          
          // 解析偏见的五个维度
          const eMatch = biasText.match(/-E:N\s+conf:\s*(\d+\.?\d+)/);
          if (eMatch) {
            biasComponents.push(`Emotional words: ${eMatch[1]} (Attack/derogatory emotional words count)`);
          }
          
          const bMatch = biasText.match(/-B:N/);
          if (bMatch) {
            biasComponents.push('Binary opposition: Present (Hostile labels count)');
          }
          
          const mMatch = biasText.match(/-M:N/);
          if (mMatch) {
            biasComponents.push('Mind-reading: Present (Assuming motives/intents count)');
          }
          
          const fMatch = biasText.match(/-F:N/);
          if (fMatch) {
            biasComponents.push('Logical fallacy: Present (Classic fallacies count)');
          }
          
          const stanceMatch = biasText.match(/-Stance:([^-\n]+)/);
          if (stanceMatch) {
            const stance = stanceMatch[1].trim();
            biasComponents.push(`Overall stance: ${stance} (neutral/leaning/critical + percentage)`);
          }
          
          if (biasComponents.length > 0) {
            parsed.bias = biasComponents;
          }
        }
      }
      
      // 从文本中提取其他信息
      const lines = resultText.split('\n');
      
      // 尝试提取可信度
      const credPhrases = ['credibility', 'credibility score', 'credibility might be'];
      for (const line of lines) {
        if (credPhrases.some(phrase => line.toLowerCase().includes(phrase))) {
          const numMatch = line.match(/(\d+(?:\.\d+)?)/);
          if (numMatch) {
            parsed.credibility = parseFloat(numMatch[1]);
            break;
          }
        }
      }
      
      // 如果没有明确的可信度，根据内容判断
      if (parsed.credibility === 0) {
        if (resultText.toLowerCase().includes('low') || 
            resultText.toLowerCase().includes('skepticism') ||
            resultText.toLowerCase().includes('lacking evidence')) {
          parsed.credibility = 3;
        } else if (resultText.toLowerCase().includes('high') || 
                   resultText.toLowerCase().includes('well')) {
          parsed.credibility = 7;
        } else {
          parsed.credibility = 5;
        }
      }

      // 提取事实
      const factKeywords = ['fact', 'claim', 'states', 'indicates', 'shows', 'demonstrates'];
      for (const line of lines) {
        if (factKeywords.some(keyword => line.toLowerCase().includes(keyword)) && 
            !line.toLowerCase().includes('opinion')) {
          const factText = line.replace(/^\d+\.\s*|\*\*.*?\*\*:\s*/g, '').trim();
          if (factText && factText.length > 10) { // 避免太短的内容
            parsed.facts.push({ content: factText, confidence: 0.6 }); // 默认中等置信度
          }
        }
      }
      
      // 如果上面没提取到事实，尝试从文本中找可能的事实陈述
      if (parsed.facts.length === 0) {
        const deviceClaims = resultText.toLowerCase().match(/the (device|product).*?(?=\.\s|$)/g);
        if (deviceClaims) {
          parsed.facts = deviceClaims.map(claim => ({
            content: claim.charAt(0).toUpperCase() + claim.slice(1),
            confidence: 0.5
          }));
        }
      }

      // 提取观点
      const opinionKeywords = ['opinion', 'view', 'believe', 'think', 'appears', 'seems'];
      for (const line of lines) {
        if (opinionKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
          const opinionText = line.replace(/^\d+\.\s*|\*\*.*?\*\*:\s*/g, '').trim();
          if (opinionText && opinionText.length > 10) {
            parsed.opinions.push({ content: opinionText, confidence: 0.7 }); // 默认较高置信度
          }
        }
      }
      
      // 如果上面没提取到观点，尝试从文本中找观点表述
      if (parsed.opinions.length === 0) {
        const opinionPhrases = resultText.toLowerCase().match(/(it is|the text|this review).*?(is|appears|seems|looks).*?(?=\.\s|$)/g);
        if (opinionPhrases) {
          parsed.opinions = opinionPhrases.map(op => ({
            content: op.charAt(0).toUpperCase() + op.slice(1),
            confidence: 0.6
          }));
        }
      }

      // 如果偏见还没解析到，尝试从文本中提取
      if (parsed.bias.length === 0) {
        if (resultText.toLowerCase().includes('bias') || 
            resultText.toLowerCase().includes('negative') ||
            resultText.toLowerCase().includes('positive')) {
          parsed.bias = [resultText.match(/(bias is|bias.*?negative|bias.*?positive)/gi)?.[0] || 'Detected bias in review'];
        } else if (resultText.toLowerCase().includes('strong language') || 
                   resultText.toLowerCase().includes('emotional')) {
          parsed.bias = ['Detected emotional language'];
        }
      }

      // 提取摘要 - 使用文本的总结部分
      const summaryPhrases = ['based on this analysis', 'in summary', 'conclusion', 'important to approach'];
      for (const line of lines) {
        if (summaryPhrases.some(phrase => line.toLowerCase().includes(phrase))) {
          parsed.summary = line.replace(/^\*\*.*?\*\*:\s*/g, '').trim();
          break;
        }
      }
      
      // 如果没有找到总结，使用最后一段有意义的内容
      if (!parsed.summary) {
        const meaningfulLines = lines.filter(line => 
          line.length > 50 && 
          !line.toLowerCase().includes('structured format') &&
          !line.toLowerCase().includes('provided') &&
          !line.toLowerCase().includes('given')
        );
        if (meaningfulLines.length > 0) {
          parsed.summary = meaningfulLines[meaningfulLines.length - 1].substring(0, 150) + '...';
        } else {
          parsed.summary = 'Analysis completed based on provided text.';
        }
      }
    }

    // 设置四维度
    parsed.dimensions = {
      ts: parsed.credibility || 5,
      fd: Math.min(10, parsed.facts.length * 2) || 5, // 根据事实数量调整
      eb: parsed.credibility >= 7 ? 8 : (parsed.credibility <= 3 ? 3 : 5), // 根据可信度调整情感中性
      cs: 5 // 一致性需要更复杂的逻辑
    };

    console.log('解析完成:', parsed);
    return parsed;
  } catch (e) {
    console.error('解析结果失败:', e);
    return {
      credibility: 0,
      facts: [{ content: '解析失败: ' + e.message, confidence: 0 }],
      opinions: [{ content: '解析失败: ' + e.message, confidence: 0 }],
      bias: ['解析失败: ' + e.message],
      publisherAdvice: '解析失败: ' + e.message,
      prReply: '解析失败: ' + e.message,
      summary: '解析失败: ' + e.message,
      dimensions: { ts: 0, fd: 0, eb: 0, cs: 0 }
    };
  }
}

// 创建雷达图
function createRadarChart(dimensions) {
  if (!ui.radarEl) return;
  
  // 销毁现有图表
  if (radarChart) {
    radarChart.destroy();
  }
  
  // 创建新图表
  radarChart = new Chart(ui.radarEl, {
    type: 'radar',
    data: {
      labels: ['Source Credibility', 'Fact Density', 'Emotional Neutrality', 'Consistency'],
      datasets: [{
        label: 'Analysis Score',
        data: [dimensions.ts, dimensions.fd, dimensions.eb, dimensions.cs],
        backgroundColor: 'rgba(37, 99, 235, 0.2)',
        borderColor: 'rgba(37, 99, 235, 1)',
        pointBackgroundColor: 'rgba(37, 99, 235, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(37, 99, 235, 1)'
      }]
    },
    options: {
      scales: {
        r: {
          beginAtZero: true,
          max: 10,
          ticks: {
            stepSize: 2
          }
        }
      }
    }
  });
}

// 渲染结果
function render(report) {
  try {
    console.log('渲染结果:', report);
    
    // 显示摘要
    if (ui.summary) {
      ui.summary.textContent = report.summary || '分析完成';
      ui.summary.classList.remove('hidden');
    }

    // 显示四维度
    if (ui.fourDim && report.dimensions) {
      ui.fourDim.classList.remove('hidden');
      
      // 更新四维度条形图
      const tsVal = document.getElementById('tsVal');
      const fdVal = document.getElementById('fdVal');
      const ebVal = document.getElementById('ebVal');
      const csVal = document.getElementById('csVal');
      const tsBar = document.getElementById('tsBar');
      const fdBar = document.getElementById('fdBar');
      const ebBar = document.getElementById('ebBar');
      const csBar = document.getElementById('csBar');
      
      // 显示具体的数字值
      if (tsVal) tsVal.textContent = report.dimensions.ts.toFixed(1);
      if (fdVal) fdVal.textContent = report.dimensions.fd.toFixed(1);
      if (ebVal) ebVal.textContent = report.dimensions.eb.toFixed(1);
      if (csVal) csVal.textContent = report.dimensions.cs.toFixed(1);
      
      // 设置条形图宽度
      if (tsBar) tsBar.style.width = `${Math.min(100, report.dimensions.ts * 10)}%`;
      if (fdBar) fdBar.style.width = `${Math.min(100, report.dimensions.fd * 10)}%`;
      if (ebBar) ebBar.style.width = `${Math.min(100, report.dimensions.eb * 10)}%`;
      if (csBar) csBar.style.width = `${Math.min(100, report.dimensions.cs * 10)}%`;
      
      // 创建雷达图
      createRadarChart(report.dimensions);
    }

    // 清空并填充结果列表
    if (ui.fact) {
      ui.fact.innerHTML = '';
      if (report.facts && report.facts.length > 0) {
        report.facts.forEach(fact => {
          const li = document.createElement('li');
          // 显示内容和置信度
          li.innerHTML = `${fact.content} <span style="color: #6b7280; font-size: 0.8em;">(${(fact.confidence * 100).toFixed(0)}%)</span>`;
          // 根据置信度添加颜色类
          if (fact.confidence >= 0.8) {
            li.classList.add('conf-high');
          } else if (fact.confidence >= 0.5) {
            li.classList.add('conf-mid');
          } else {
            li.classList.add('conf-low');
          }
          ui.fact.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = '未检测到明确的事实';
        ui.fact.appendChild(li);
      }
    }

    if (ui.opinion) {
      ui.opinion.innerHTML = '';
      if (report.opinions && report.opinions.length > 0) {
        report.opinions.forEach(op => {
          const li = document.createElement('li');
          // 显示内容和置信度
          li.innerHTML = `${op.content} <span style="color: #6b7280; font-size: 0.8em;">(${(op.confidence * 100).toFixed(0)}%)</span>`;
          // 根据置信度添加颜色类
          if (op.confidence >= 0.8) {
            li.classList.add('conf-high');
          } else if (op.confidence >= 0.5) {
            li.classList.add('conf-mid');
          } else {
            li.classList.add('conf-low');
          }
          ui.opinion.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = '未检测到明确的观点';
        ui.opinion.appendChild(li);
      }
    }

    if (ui.bias) {
      ui.bias.innerHTML = '';
      if (report.bias && report.bias.length > 0) {
        report.bias.forEach(b => {
          const li = document.createElement('li');
          li.textContent = b;
          ui.bias.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = '未检测到明显的偏见';
        ui.bias.appendChild(li);
      }
    }

    // 填充发布商建议和公关回复
    const pubAdvice = document.getElementById('pubAdvice');
    const prAdvice = document.getElementById('prAdvice');
    if (pubAdvice) pubAdvice.textContent = report.publisherAdvice || '暂无建议';
    if (prAdvice) prAdvice.textContent = report.prReply || '暂无回复';

    // 显示结果区域
    if (ui.results) ui.results.classList.remove('hidden');
  } catch (e) {
    console.error('渲染结果失败:', e);
    alert('渲染结果时出现错误: ' + e.message);
  }
}

// 分析内容函数
async function analyzeContent(content, title) {
  let progressInterval; // 在函数开始处声明
  
  try {
    console.log('开始分析内容:', { content: content.substring(0, 100) + '...', title });
    
    // 模拟进度更新
    let progress = 0;
    progressInterval = setInterval(() => {
      if (progress < 95) {
        progress += 5;
        const progressInner = document.getElementById('progressInner');
        const pctElement = document.getElementById('pct');
        if (progressInner) progressInner.style.width = progress + '%';
        if (pctElement) pctElement.textContent = Math.round(progress);
      }
    }, 500);
    
    // 设置超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log('请求超时');
    }, 45000); // 45秒超时
    
    try {
      console.log('发送请求到API...');
      const response = await fetch('/api/analyze', { // 更新API端点
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      if (progressInterval) clearInterval(progressInterval);
      
      console.log('API响应状态:', response.status);
      const progressInner = document.getElementById('progressInner');
      const pctElement = document.getElementById('pct');
      if (progressInner) progressInner.style.width = '98%';
      if (pctElement) pctElement.textContent = '98';
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API响应错误:', response.status, errorText);
        throw new Error(`API请求失败: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('API响应数据:', data);
      
      if (progressInner) progressInner.style.width = '100%';
      if (pctElement) pctElement.textContent = '100';
      
      // 获取结果文本
      const resultText = data.choices?.[0]?.message?.content || 
                        (data.error ? `Error: ${data.error}` : 
                         (data && typeof data === 'object' ? JSON.stringify(data) : String(data)));
      
      console.log('原始结果文本:', resultText);
      
      const parsedResult = parseResult(resultText);
      console.log('解析后的结果:', parsedResult);
      
      return parsedResult;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (progressInterval) clearInterval(progressInterval);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('请求超时，请稍后重试');
      }
      throw fetchError;
    }
  } catch (e) {
    console.error('分析内容失败:', e);
    if (progressInterval) clearInterval(progressInterval);
    throw e;
  }
}

// 主处理函数
async function handleAnalyze() {
  const raw = ui.input?.value.trim(); 
  if (!raw) {
    alert('请输入要分析的内容');
    return; 
  }
  
  if (isAnalyzing) {
    console.log('分析正在进行中，请稍候...');
    return;
  }
  
  isAnalyzing = true;
  if (ui.btn) {
    ui.btn.disabled = true;
    ui.btn.textContent = 'Analyzing...';
  }
  
  showProgress();
  
  try {
    console.log('开始获取内容...');
    const { content, title } = await fetchContent(raw);
    console.log('获取内容完成:', { content: content.substring(0, 100) + '...', title });
    
    // LRU缓存检查
    const cached = await getCache(content, title);
    if (cached) {
      console.log('使用缓存结果');
      render(cached);
      return;
    }
    
    console.log('执行实时分析...');
    const report = await analyzeContent(content, title);
    console.log('分析完成，保存到缓存');
    await setCache(content, title, report);
    render(report);
  } catch (e) {
    console.error('处理分析失败:', e);
    
    // 显示错误信息
    if (ui.summary) {
      ui.summary.textContent = '分析失败: ' + e.message;
      ui.summary.classList.remove('hidden');
      if (ui.summary.classList) {
        ui.summary.classList.add('conf-low');
      }
    }
    
    // 隐藏其他结果
    if (ui.fourDim) ui.fourDim.classList.add('hidden');
    if (ui.results) ui.results.classList.add('hidden');
  } finally {
    hideProgress();
    isAnalyzing = false;
    if (ui.btn) {
      ui.btn.disabled = false;
      ui.btn.textContent = 'Analyze';
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('页面加载完成，初始化事件监听器');
  if (ui.btn) ui.btn.addEventListener('click', handleAnalyze);
  
  // 支持回车键触发分析
  if (ui.input) {
    ui.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAnalyze();
      }
    });
  }
  
  // 雷达图切换功能
  if (ui.radarTgl && ui.radarEl) {
    ui.radarTgl.addEventListener('click', () => {
      ui.radarEl.classList.toggle('hidden');
      const text = ui.radarTgl.textContent;
      if (ui.radarEl.classList.contains('hidden')) {
        ui.radarTgl.textContent = 'View Radar Chart';
      } else {
        ui.radarTgl.textContent = 'Hide Radar Chart';
      }
    });
  }
});




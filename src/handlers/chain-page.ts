// Chain page HTML template
function generateChainPage(chain: string, chainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${chainName} RPC - NullRPC</title>
  <meta name="description" content="Free, privacy-focused RPC endpoint for ${chainName}. No IP logging. No tracking.">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://nullrpc.dev/${chain}">
  <meta property="og:title" content="${chainName} RPC - NullRPC">
  <meta property="og:description" content="Free, privacy-focused RPC endpoint for ${chainName}. No IP logging. No tracking.">
  <meta property="og:image" content="https://imagedelivery.net/vgqvCj4Mw_NLJNB76Px9jg/c7f2ed26-ab1f-4cd0-1568-b1ff4c32ed00/public">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="https://nullrpc.dev/${chain}">
  <meta property="twitter:title" content="${chainName} RPC - NullRPC">
  <meta property="twitter:description" content="Free, privacy-focused RPC endpoint for ${chainName}. No IP logging. No tracking.">
  <meta property="twitter:image" content="https://imagedelivery.net/vgqvCj4Mw_NLJNB76Px9jg/c7f2ed26-ab1f-4cd0-1568-b1ff4c32ed00/public">
  
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --null-black: #050510;
      --ether-blue: #007AFF;
      --cyan-ray: #00D4FF;
      --status-green: #00FF94;
      --terminal-grey: #8F9CA9;
      --white: #FFFFFF;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--null-black);
      color: var(--terminal-grey);
      line-height: 1.6;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    header {
      padding: 24px 0;
      border-bottom: 1px solid rgba(0, 212, 255, 0.1);
    }
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo { height: 40px; }
    .nav-links { display: flex; gap: 32px; }
    .nav-links a {
      color: var(--terminal-grey);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.2s;
    }
    .nav-links a:hover { color: var(--cyan-ray); }
    
    .hero {
      padding: 80px 0;
      text-align: center;
      position: relative;
    }
    .hero::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(0, 122, 255, 0.15) 0%, transparent 70%);
      pointer-events: none;
    }
    .chain-badge {
      display: inline-block;
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 20px;
      padding: 8px 20px;
      font-size: 14px;
      color: var(--cyan-ray);
      margin-bottom: 24px;
      position: relative;
    }
    .hero h1 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 48px;
      font-weight: 700;
      color: var(--white);
      margin-bottom: 16px;
      position: relative;
    }
    .hero .tagline {
      font-size: 18px;
      opacity: 0.7;
      margin-bottom: 32px;
      position: relative;
    }
    .endpoint-box {
      background: rgba(0, 212, 255, 0.05);
      border: 1px solid rgba(0, 212, 255, 0.2);
      border-radius: 12px;
      padding: 20px 28px;
      display: inline-flex;
      align-items: center;
      gap: 16px;
      font-family: 'JetBrains Mono', monospace;
      position: relative;
    }
    .endpoint-box code {
      color: var(--cyan-ray);
      font-size: 16px;
    }
    .copy-btn {
      background: var(--ether-blue);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .copy-btn:hover { background: var(--cyan-ray); }
    
    .analytics-section {
      padding: 60px 0;
      border-top: 1px solid rgba(0, 212, 255, 0.1);
    }
    .section-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 28px;
      color: var(--white);
      text-align: center;
      margin-bottom: 40px;
    }
    .analytics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
      margin-bottom: 48px;
    }
    .stat-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 28px;
      color: var(--white);
      font-weight: 700;
    }
    .stat-label {
      font-size: 14px;
      margin-top: 8px;
      opacity: 0.7;
    }
    .chart-container {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 16px;
      padding: 32px;
    }
    .chart-title {
      font-family: 'JetBrains Mono', monospace;
      color: var(--white);
      font-size: 18px;
      margin-bottom: 24px;
    }
    .chart-wrapper {
      position: relative;
      height: 300px;
      width: 100%;
    }
    #requestsChart {
      position: absolute;
      top: 0;
      left: 0;
      width: 100% !important;
      height: 100% !important;
    }
    
    footer {
      padding: 48px 0;
      border-top: 1px solid rgba(0, 212, 255, 0.1);
      margin-top: 60px;
    }
    .footer-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .footer-logo { height: 32px; }
    .footer-text { font-size: 14px; opacity: 0.7; }
    .footer-links { display: flex; gap: 24px; }
    .footer-links a {
      color: var(--terminal-grey);
      text-decoration: none;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: color 0.2s;
    }
    .footer-links a:hover { color: var(--cyan-ray); }
    .footer-links svg { width: 20px; height: 20px; fill: currentColor; }
    
    @media (max-width: 768px) {
      .analytics-grid { grid-template-columns: repeat(2, 1fr); }
      .footer-content { flex-direction: column; gap: 24px; text-align: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container header-content">
      <a href="/"><img src="https://imagedelivery.net/vgqvCj4Mw_NLJNB76Px9jg/4f7c2110-61c0-4c34-a0f2-5b9a49a7aa00/public" alt="NullRPC" class="logo"></a>
      <nav class="nav-links">
        <a href="/#chains">All Chains</a>
        <a href="https://github.com/0xeabz/null-rpc" target="_blank">GitHub</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container">
        <span class="chain-badge">${chain.toUpperCase()}</span>
        <h1>${chainName}</h1>
        <p class="tagline">Privacy-focused RPC endpoint. No logging. No tracking.</p>
        
        <div class="endpoint-box">
          <code>https://nullrpc.dev/${chain}</code>
          <button class="copy-btn" onclick="navigator.clipboard.writeText('https://nullrpc.dev/${chain}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)">Copy</button>
        </div>
      </div>
    </section>

    <section class="analytics-section">
      <div class="container">
        <h2 class="section-title">Analytics</h2>
        
        <div class="analytics-grid">
          <div class="stat-card">
            <div class="stat-value" id="totalRequests">-</div>
            <div class="stat-label">Requests (24h)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="avgLatency">-</div>
            <div class="stat-label">Avg Latency</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="cacheHitRate">-</div>
            <div class="stat-label">Cache Hit Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="errorRate">-</div>
            <div class="stat-label">Error Rate</div>
          </div>
        </div>

        <div class="chart-container">
          <h3 class="chart-title">Requests per Hour</h3>
          <div class="chart-wrapper">
            <canvas id="requestsChart"></canvas>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="container footer-content">
      <div class="footer-left">
        <img src="https://imagedelivery.net/vgqvCj4Mw_NLJNB76Px9jg/4f7c2110-61c0-4c34-a0f2-5b9a49a7aa00/public" alt="NullRPC" class="footer-logo">
        <span class="footer-text">© 2025 NullRPC</span>
      </div>
      <div class="footer-links">
        <a href="https://github.com/0xeabz/null-rpc" target="_blank">
          <svg viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </a>
        <a href="https://x.com/0xeabz" target="_blank">
          <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          @0xeabz
        </a>
      </div>
    </div>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const CHAIN = '${chain}';

    // Chain Configuration
    const chainIcons = {
      eth: 'https://s2.coinmarketcap.com/static/img/coins/128x128/1027.png',
      bsc: 'https://cryptologos.cc/logos/bnb-bnb-logo.svg',
      polygon: 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
      arbitrum: 'https://s2.coinmarketcap.com/static/img/coins/128x128/11841.png',
      optimism: 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.svg',
      base: 'https://avatars.githubusercontent.com/u/108554348?s=200&v=4',
      unichain: 'https://icons.llamao.fi/icons/chains/rsz_unichain.jpg',
      berachain: 'https://icons.llamao.fi/icons/chains/rsz_berachain.jpg',
    };

    const chainNames = {
      eth: 'Ethereum',
      bsc: 'Binance Smart Chain',
      polygon: 'Polygon',
      arbitrum: 'Arbitrum One',
      optimism: 'Optimism',
      base: 'Base',
      unichain: 'Unichain',
      berachain: 'Berachain',
      plasma: 'Plasma',
      katana: 'Katana Network',
    };

    const getDisplayName = (chain) => chainNames[chain] || chain;
    
    // Set chain icon
    const iconUrl = chainIcons[CHAIN];
    if (iconUrl) {
      const heroContainer = document.querySelector('.hero .container');
      const badge = heroContainer.querySelector('.chain-badge');
      const iconImg = document.createElement('img');
      iconImg.src = iconUrl;
      iconImg.alt = getDisplayName(CHAIN);
      iconImg.style.width = '64px';
      iconImg.style.height = '64px';
      iconImg.style.borderRadius = '50%';
      iconImg.style.marginBottom = '24px';
      iconImg.style.display = 'block';
      iconImg.style.margin = '0 auto 24px auto';
      
      // Replace text badge with icon if available
      badge.style.display = 'none';
      heroContainer.insertBefore(iconImg, badge);
    }
    
    // Set proper display name
    document.querySelector('h1').textContent = getDisplayName(CHAIN);
    document.title = \`\${getDisplayName(CHAIN)} RPC - NullRPC\`;
    
    async function loadAnalytics() {
      try {
        // Fetch chain-specific analytics
        const res = await fetch(\`/analytics?chain=\${CHAIN}\`);
        const data = await res.json();
        
        if (data.overview && data.overview[0]) {
          const ov = data.overview[0];
          document.getElementById('totalRequests').textContent = formatNumber(ov.total_requests || 0);
          document.getElementById('avgLatency').textContent = (ov.avg_latency_ms || 0).toFixed(0) + 'ms';
          
          const cacheRate = ov.cache_hits / (ov.total_requests || 1) * 100;
          document.getElementById('cacheHitRate').textContent = cacheRate.toFixed(1) + '%';
          
          const errorRate = ov.errors / (ov.total_requests || 1) * 100;
          document.getElementById('errorRate').textContent = errorRate.toFixed(2) + '%';
        }
        
        // Load timeseries
        if (data.timeseries && data.timeseries.length > 0) {
          renderChart(data.timeseries);
        }
      } catch (e) {
        console.error('Failed to load analytics:', e);
      }
    }
    
    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }
    
    function renderChart(timeseries) {
      const canvas = document.getElementById('requestsChart');
      const existingChart = Chart.getChart(canvas);
      if (existingChart) existingChart.destroy();
      
      const hourlyData = {};
      timeseries.forEach(item => {
        if (!hourlyData[item.hour]) hourlyData[item.hour] = 0;
        hourlyData[item.hour] += item.requests;
      });
      
      const labels = Object.keys(hourlyData).sort().slice(-24);
      const values = labels.map(h => hourlyData[h]);
      
      new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels.map(h => new Date(h).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          datasets: [{
            label: 'Requests',
            data: values,
            borderColor: '#00D4FF',
            backgroundColor: 'rgba(0, 212, 255, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#00D4FF'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8F9CA9' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8F9CA9' }, beginAtZero: true }
          }
        }
      });
    }
    
    loadAnalytics();
  </script>
</body>
</html>`
}

export async function handleChainPage(chain: string, env: Env): Promise<Response | null> {
  // Look up chain in database
  try {
    const result = await env.DB.prepare('SELECT slug, name FROM chains WHERE slug = ?').bind(chain).first()

    if (!result) {
      return null // Chain not found, let RPC handler deal with it
    }

    const chainName = (result.name as string) || chain
    const html = generateChainPage(chain, chainName)

    return new Response(html, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Content-Type': 'text/html; charset=utf-8'
      }
    })
  } catch {
    return null
  }
}

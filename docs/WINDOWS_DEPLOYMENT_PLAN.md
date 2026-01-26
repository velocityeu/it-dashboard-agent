# Windows Deployment Plan: IT Dashboard Agent

## Executive Summary

This document outlines a comprehensive plan to package the IT Dashboard Agent for deployment on Windows machines (Windows Server 2016+ and Windows 11). The solution includes:

- **Single-file executable** with embedded Node.js runtime
- **MSI installer** for enterprise deployment
- **Automated configuration wizard** for backend connection setup
- **Windows Service integration** for persistent operation

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Proposed Architecture](#2-proposed-architecture)
3. [Packaging Strategy](#3-packaging-strategy)
4. [Installation Process](#4-installation-process)
5. [Configuration Automation](#5-configuration-automation)
6. [Windows Service Integration](#6-windows-service-integration)
7. [Directory Structure](#7-directory-structure)
8. [Security Considerations](#8-security-considerations)
9. [Testing Strategy](#9-testing-strategy)
10. [Implementation Phases](#10-implementation-phases)
11. [Alternative Approaches](#11-alternative-approaches)

---

## 1. Current State Analysis

### 1.1 Application Overview

| Aspect | Details |
|--------|---------|
| Runtime | Node.js 18+ |
| Language | TypeScript (compiled to ES2022) |
| Module System | ES Modules |
| Entry Point | `dist/index.js` |
| Static Assets | `dist/ui/public/` (Web UI) |

### 1.2 Dependencies

**Production Dependencies (11 packages):**
```
axios@1.6.0           - HTTP client
express@5.2.1         - Web framework
socket.io@4.8.3       - Real-time communication
dotenv@16.3.0         - Environment configuration
winston@3.11.0        - Logging
net-snmp@3.26.1       - SNMP protocol (native bindings)
node-ssdp@4.0.1       - UPnP discovery
oui@13.1.3            - MAC vendor lookup
oui-data@1.1.516      - MAC vendor database (~5MB)
@types/express        - Type definitions
@types/node-ssdp      - Type definitions
```

**Key Considerations:**
- `net-snmp` has native Node.js addons that need platform-specific compilation
- `oui-data` is a large (~5MB) JSON database that must be bundled
- Total `node_modules` size: ~80-100MB (can be reduced with tree-shaking)

### 1.3 Configuration Requirements

| Variable | Required | Description |
|----------|----------|-------------|
| `DASHBOARD_URL` | Yes | IT Dashboard backend URL |
| `AGENT_API_KEY` | Yes | Authentication token from dashboard |
| `AGENT_NAME` | No | Display name for this agent |
| `HEARTBEAT_INTERVAL` | No | Heartbeat frequency (default: 60s) |
| `STATUS_CHECK_INTERVAL` | No | Status check frequency (default: 30s) |
| `LOG_LEVEL` | No | Logging verbosity (default: info) |

### 1.4 Current Deployment Method

Manual process requiring:
1. Install Node.js
2. Clone repository
3. Run `npm install`
4. Configure `.env` file
5. Run `npm run build`
6. Install NSSM
7. Create Windows service manually

**Problems:**
- Requires technical expertise
- Node.js version conflicts
- Manual service configuration
- No upgrade path
- No centralized management

---

## 2. Proposed Architecture

### 2.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IT Dashboard Agent Installer                      │
│                         (MSI Package)                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 Single Executable (pkg)                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────────┐   │  │
│  │  │  Node.js    │  │  App Code   │  │   Dependencies     │   │  │
│  │  │  Runtime    │  │  (dist/)    │  │  (node_modules)    │   │  │
│  │  │  v22 LTS    │  │             │  │                    │   │  │
│  │  └─────────────┘  └─────────────┘  └────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │  Configuration   │  │  Windows Service │  │   Firewall      │  │
│  │  Wizard (CLI)    │  │  Integration     │  │   Rules         │  │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| Executable | `pkg` by Vercel | Bundle Node.js + app into single .exe |
| Installer | WiX Toolset v4 | Create MSI for enterprise deployment |
| Service Wrapper | `node-windows` | Native Windows Service integration |
| Config Wizard | Interactive CLI | Guide user through setup |
| Updater | Custom module | Check and apply updates |

---

## 3. Packaging Strategy

### 3.1 Primary Approach: pkg + MSI

**Stage 1: Create Single Executable with `pkg`**

`pkg` compiles Node.js applications into standalone executables that include:
- Node.js runtime (selected version)
- Application code
- All dependencies
- Static assets

**pkg Configuration (`package.json` additions):**
```json
{
  "bin": "dist/index.js",
  "pkg": {
    "scripts": "dist/**/*.js",
    "assets": [
      "dist/ui/public/**/*",
      "node_modules/oui-data/**/*"
    ],
    "targets": [
      "node22-win-x64"
    ],
    "outputPath": "build"
  }
}
```

**Build Command:**
```bash
npx pkg . --target node22-win-x64 --output build/it-dashboard-agent.exe
```

**Expected Output:**
- Single `it-dashboard-agent.exe` (~80-100MB)
- No external Node.js required
- No external `node_modules` required

**Stage 2: Create MSI Installer with WiX Toolset**

The MSI installer will:
1. Install the executable to `C:\Program Files\IT Dashboard Agent\`
2. Create configuration directory at `C:\ProgramData\IT Dashboard Agent\`
3. Register Windows Service
4. Create Start Menu shortcuts
5. Add uninstaller to Programs and Features
6. Configure Windows Firewall rules (outbound HTTPS)

### 3.2 File Structure After Installation

```
C:\Program Files\IT Dashboard Agent\
├── it-dashboard-agent.exe      # Main executable
├── it-dashboard-config.exe     # Configuration wizard
├── LICENSE.txt
├── README.txt
└── version.txt

C:\ProgramData\IT Dashboard Agent\
├── config.json                  # Configuration (replaces .env)
├── logs\
│   ├── agent.log               # Current log file
│   └── agent-{date}.log        # Rotated logs
└── data\
    └── cache\                   # Any cached data
```

### 3.3 Native Module Handling

The `net-snmp` package contains native Node.js addons. Strategy:

**Option A: Pre-compiled Binaries (Recommended)**
- Include pre-compiled `.node` files for Windows x64
- `pkg` supports this via the `assets` configuration

**Option B: Make SNMP Optional**
- SNMP is used for device information only (not required for core functionality)
- Could make SNMP a conditional feature based on availability

**Option C: Pure JavaScript Alternative**
- Replace `net-snmp` with a pure JS implementation
- Trade-off: Slightly reduced functionality

### 3.4 Handling ES Modules

Since the project uses ES Modules (`"type": "module"`), we need to ensure compatibility:

```json
{
  "pkg": {
    "options": ["--no-warnings"]
  }
}
```

If ES Module issues arise, we can add a CommonJS wrapper:

```javascript
// dist/pkg-entry.cjs
(async () => {
  await import('./index.js');
})();
```

---

## 4. Installation Process

### 4.1 Installation Modes

**Mode 1: Interactive Installation (GUI)**
```
1. User runs ITDashboardAgent-Setup.msi
2. Welcome screen with branding
3. License agreement (MIT)
4. Installation directory selection (default recommended)
5. Configuration wizard launch option
6. Installation progress
7. Completion with "Open Configuration" option
```

**Mode 2: Silent Installation (Enterprise/GPO)**
```cmd
msiexec /i ITDashboardAgent-Setup.msi /qn ^
  DASHBOARD_URL="https://dashboard.example.com" ^
  AGENT_API_KEY="agt_xxxx" ^
  AGENT_NAME="Server Room Agent"
```

**Mode 3: Configuration File Pre-seeding**
```cmd
:: Create config.json before installation
echo {"dashboardUrl":"https://...","apiKey":"agt_..."} > config.json

:: Install with pre-existing config
msiexec /i ITDashboardAgent-Setup.msi /qn CONFIG_FILE="C:\path\to\config.json"
```

### 4.2 Installation Steps (Internal)

```
1. Check Prerequisites
   ├── Windows version (Server 2016+ / Windows 10+)
   ├── .NET Framework 4.7.2+ (for WiX UI)
   └── Administrator privileges

2. Stop Existing Service (if upgrading)
   └── sc stop ITDashboardAgent

3. Copy Files
   ├── C:\Program Files\IT Dashboard Agent\*
   └── C:\ProgramData\IT Dashboard Agent\* (preserve config on upgrade)

4. Register Windows Service
   ├── Create service: ITDashboardAgent
   ├── Display name: IT Dashboard Agent
   ├── Start type: Automatic (Delayed Start)
   └── Recovery: Restart on failure (3 attempts)

5. Configure Firewall
   └── Add outbound rule for HTTPS (port 443)

6. Create Shortcuts
   ├── Start Menu: IT Dashboard Agent folder
   │   ├── Configure Agent
   │   ├── View Logs
   │   ├── Open Web UI
   │   └── Uninstall
   └── Desktop (optional)

7. Start Service (if config exists)
   └── sc start ITDashboardAgent

8. Launch Configuration Wizard (if no config)
```

### 4.3 Upgrade Process

```
1. Detect existing installation via registry
2. Stop running service
3. Backup current config.json
4. Install new files (overwrite executable)
5. Preserve config.json and logs
6. Start service with new version
7. Verify heartbeat success
```

### 4.4 Uninstallation

```
1. Stop and remove Windows Service
2. Remove firewall rules
3. Remove program files
4. Optionally preserve configuration and logs
5. Remove registry entries
6. Remove shortcuts
```

---

## 5. Configuration Automation

### 5.1 Configuration Wizard Design

**Interactive CLI Wizard (`it-dashboard-config.exe`):**

```
┌─────────────────────────────────────────────────────────────┐
│           IT Dashboard Agent - Configuration                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This wizard will help you configure the IT Dashboard       │
│  Agent to connect to your dashboard.                        │
│                                                             │
│  Step 1 of 4: Dashboard URL                                 │
│  ─────────────────────────────────────────                  │
│  Enter the URL of your IT Dashboard:                        │
│                                                             │
│  > https://it-dashboard-gray.vercel.app                     │
│                                                             │
│  [Validating...] ✓ Dashboard reachable                     │
│                                                             │
│  Press Enter to continue or Ctrl+C to cancel                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Wizard Flow:**

```
Step 1: Dashboard URL
├── Prompt for URL
├── Validate URL format
├── Test HTTPS connection
└── Verify API endpoint responds

Step 2: API Key
├── Prompt for API key
├── Validate format (agt_xxxxx)
├── Test authentication against dashboard
└── Retrieve agent details if valid

Step 3: Agent Name
├── Show suggested name from dashboard
├── Allow override
└── Validate uniqueness (optional)

Step 4: Advanced Settings (Optional)
├── Heartbeat interval
├── Status check interval
├── Log level
└── UI port

Step 5: Review & Save
├── Display configuration summary
├── Write config.json
├── Set file permissions (restrict to SYSTEM/Administrators)
└── Offer to start service
```

### 5.2 Configuration File Format

**New: `config.json` (replaces `.env`)**

```json
{
  "version": 1,
  "dashboard": {
    "url": "https://it-dashboard-gray.vercel.app",
    "apiKey": "agt_McoWVe_DOfX7O07kKxKBcnudNYe-Whdp"
  },
  "agent": {
    "name": "Office Network Agent",
    "id": null
  },
  "intervals": {
    "heartbeat": 60,
    "statusCheck": 30
  },
  "logging": {
    "level": "info",
    "maxFiles": 7,
    "maxSize": "10m"
  },
  "ui": {
    "enabled": true,
    "port": 3001,
    "bindAddress": "127.0.0.1"
  }
}
```

### 5.3 Configuration Sources (Priority Order)

```
1. Command-line arguments (highest priority)
2. Environment variables
3. config.json file
4. Default values (lowest priority)
```

### 5.4 API Key Provisioning Options

**Option A: Manual Entry (Current)**
- User creates agent in dashboard
- Dashboard generates API key
- User copies key to agent configuration

**Option B: Enrollment Token (Recommended for Scale)**
```
1. Admin generates enrollment token in dashboard (time-limited)
2. Token shared with installer
3. Agent uses token to self-register
4. Dashboard returns permanent API key
5. Agent stores permanent key
```

**Enrollment Flow:**
```
POST /api/agent/enroll
{
  "enrollment_token": "enr_xxxxxx",
  "hostname": "SERVER01",
  "ip_address": "10.1.1.50",
  "os": "Windows Server 2022"
}

Response:
{
  "success": true,
  "agent_id": "ag_123",
  "api_key": "agt_permanent_key",
  "name": "SERVER01"
}
```

**Option C: Domain Join (Enterprise)**
- Agent reads machine domain/workgroup
- Uses Kerberos/NTLM to authenticate to dashboard
- Dashboard auto-provisions based on AD group membership

### 5.5 Connection Validation

**Validation Steps:**
```typescript
async function validateConnection(config: Config): Promise<ValidationResult> {
  const results = {
    urlReachable: false,
    apiValid: false,
    agentRegistered: false,
    segmentsAssigned: false
  };

  // Step 1: Basic connectivity
  try {
    await axios.get(config.dashboardUrl, { timeout: 5000 });
    results.urlReachable = true;
  } catch (e) {
    return { success: false, error: 'Cannot reach dashboard URL', results };
  }

  // Step 2: API authentication
  try {
    const response = await axios.post(
      `${config.dashboardUrl}/api/agent/heartbeat`,
      { version: '1.0.0', hostname: os.hostname() },
      { headers: { Authorization: `Bearer ${config.apiKey}` } }
    );
    results.apiValid = true;
    results.agentRegistered = !!response.data.agent_id;
    results.segmentsAssigned = response.data.segments?.length > 0;
  } catch (e) {
    if (e.response?.status === 401) {
      return { success: false, error: 'Invalid API key', results };
    }
    return { success: false, error: 'API connection failed', results };
  }

  return { success: true, results };
}
```

---

## 6. Windows Service Integration

### 6.1 Service Configuration

**Service Properties:**
```
Service Name:      ITDashboardAgent
Display Name:      IT Dashboard Agent
Description:       Monitors network devices and reports to IT Dashboard
Startup Type:      Automatic (Delayed Start)
Account:           Local System
Recovery:
  - First failure:  Restart service
  - Second failure: Restart service
  - Subsequent:     Restart service
  - Reset count:    1 day
  - Restart delay:  60 seconds
```

### 6.2 Implementation Approach

**Using `node-windows` package (recommended for pkg):**

The main executable will include service management capabilities:

```bash
# Install service
it-dashboard-agent.exe --install-service

# Uninstall service
it-dashboard-agent.exe --uninstall-service

# Run as service (called by Windows SCM)
it-dashboard-agent.exe --service
```

**Service Entry Point:**
```typescript
// service-wrapper.ts
import { Service } from 'node-windows';

const svc = new Service({
  name: 'ITDashboardAgent',
  description: 'IT Dashboard network monitoring agent',
  script: 'C:\\Program Files\\IT Dashboard Agent\\it-dashboard-agent.exe',
  nodeOptions: [],
  env: [{
    name: 'CONFIG_PATH',
    value: 'C:\\ProgramData\\IT Dashboard Agent\\config.json'
  }]
});

svc.on('install', () => svc.start());
svc.install();
```

### 6.3 Service Control

**CLI Commands:**
```cmd
:: Start service
net start ITDashboardAgent
sc start ITDashboardAgent

:: Stop service
net stop ITDashboardAgent
sc stop ITDashboardAgent

:: Check status
sc query ITDashboardAgent

:: Via our tool
it-dashboard-agent.exe --status
it-dashboard-agent.exe --start
it-dashboard-agent.exe --stop
it-dashboard-agent.exe --restart
```

### 6.4 Event Log Integration

Log to Windows Event Log in addition to file logs:

```typescript
import { EventLogger } from 'node-windows';

const log = new EventLogger('IT Dashboard Agent');

// Log levels map to Event Log types
log.info('Agent started successfully');
log.warn('Lost connection to dashboard, retrying...');
log.error('Failed to scan network segment: Access denied');
```

**Event Log Location:**
`Event Viewer > Applications and Services Logs > IT Dashboard Agent`

---

## 7. Directory Structure

### 7.1 Build/Development Structure

```
it-dashboard-agent/
├── src/                          # TypeScript source
│   ├── index.ts                  # Main entry
│   ├── config.ts                 # Configuration loader (update for JSON)
│   ├── api/
│   ├── scanner/
│   ├── ui/
│   ├── utils/
│   ├── service/                  # NEW: Windows service integration
│   │   ├── service-manager.ts    # Install/uninstall/control service
│   │   └── event-logger.ts       # Windows Event Log integration
│   └── installer/                # NEW: Installation support
│       ├── config-wizard.ts      # Interactive configuration
│       ├── validator.ts          # Connection validation
│       └── migrate.ts            # Config migration (.env → JSON)
├── installer/                    # NEW: Installer build files
│   ├── wix/
│   │   ├── Product.wxs           # Main WiX configuration
│   │   ├── UI.wxs                # Custom UI dialogs
│   │   └── Properties.wxs        # MSI properties
│   ├── scripts/
│   │   ├── pre-install.ps1       # Pre-installation checks
│   │   └── post-install.ps1      # Post-installation setup
│   └── assets/
│       ├── icon.ico              # Application icon
│       ├── banner.bmp            # Installer banner
│       └── dialog.bmp            # Installer background
├── scripts/                      # NEW: Build scripts
│   ├── build-exe.js              # pkg build script
│   ├── build-msi.ps1             # MSI build script
│   └── sign-binaries.ps1         # Code signing script
├── dist/                         # Compiled JavaScript
├── build/                        # NEW: Build output
│   ├── it-dashboard-agent.exe    # Packaged executable
│   └── ITDashboardAgent-{ver}.msi # Installer
├── package.json
├── tsconfig.json
└── README.md
```

### 7.2 Installed Structure (End User)

```
C:\Program Files\IT Dashboard Agent\
├── it-dashboard-agent.exe        # Main executable (80-100MB)
├── it-dashboard-config.exe       # Configuration wizard (could be same exe with --config flag)
├── LICENSE.txt
├── README.txt
└── version.txt

C:\ProgramData\IT Dashboard Agent\
├── config.json                   # Configuration
├── logs\
│   ├── agent.log                 # Current log (10MB max)
│   ├── agent.2024-01-15.log      # Rotated logs
│   └── ...
└── data\
    └── device-cache.json         # Optional: device discovery cache

Registry:
HKLM\SOFTWARE\IT Dashboard Agent\
├── InstallPath = "C:\Program Files\IT Dashboard Agent"
├── ConfigPath = "C:\ProgramData\IT Dashboard Agent"
├── Version = "1.0.0"
└── InstallDate = "2024-01-15"
```

---

## 8. Security Considerations

### 8.1 API Key Protection

**Problem:** API key grants full agent access to dashboard

**Solutions:**
1. **File System Permissions**
   - `config.json` readable only by SYSTEM and Administrators
   - ACL: `SYSTEM:F`, `Administrators:F`, `Users:` (none)

2. **Windows Credential Manager (Advanced)**
   ```typescript
   // Store API key in Windows Credential Manager
   import keytar from 'keytar';

   await keytar.setPassword('ITDashboardAgent', 'apiKey', 'agt_xxx');
   const apiKey = await keytar.getPassword('ITDashboardAgent', 'apiKey');
   ```

3. **DPAPI Encryption (Advanced)**
   - Encrypt config.json using Windows DPAPI
   - Only decryptable on same machine by same user context

### 8.2 Code Signing

**Required for enterprise deployment:**
```powershell
# Sign executable
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
  /a "build\it-dashboard-agent.exe"

# Sign MSI
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
  /a "build\ITDashboardAgent-1.0.0.msi"
```

**Benefits:**
- Prevents "Unknown Publisher" warnings
- Required for Windows SmartScreen approval
- Enterprise GPO deployment often requires signed packages

### 8.3 Firewall Configuration

**Outbound Rules Only:**
```powershell
# Created by installer
netsh advfirewall firewall add rule name="IT Dashboard Agent" ^
  dir=out action=allow program="C:\Program Files\IT Dashboard Agent\it-dashboard-agent.exe" ^
  enable=yes profile=any

# Optional: Allow local UI access
netsh advfirewall firewall add rule name="IT Dashboard Agent UI" ^
  dir=in action=allow protocol=tcp localport=3001 ^
  program="C:\Program Files\IT Dashboard Agent\it-dashboard-agent.exe" ^
  enable=yes profile=private
```

### 8.4 Principle of Least Privilege

**Network Scanning Considerations:**
- ARP scanning requires elevated privileges (raw sockets)
- ICMP ping requires appropriate permissions
- Running as LocalSystem provides necessary access

**Alternative: Managed Service Account**
```powershell
# Create gMSA for agent
New-ADServiceAccount -Name "svc-itdashboard" -DNSHostName "svc-itdashboard.domain.local"
```

---

## 9. Testing Strategy

### 9.1 Test Environments

| Environment | OS | Purpose |
|-------------|-------|---------|
| Dev VM 1 | Windows 11 Pro 23H2 | Desktop development |
| Test VM 1 | Windows Server 2016 | Legacy server support |
| Test VM 2 | Windows Server 2019 | Standard server |
| Test VM 3 | Windows Server 2022 | Latest server |
| Test VM 4 | Windows 11 Enterprise | Enterprise desktop |

### 9.2 Test Cases

**Installation Tests:**
- [ ] Fresh install (interactive)
- [ ] Fresh install (silent)
- [ ] Upgrade from previous version
- [ ] Upgrade preserves configuration
- [ ] Uninstall removes all components
- [ ] Uninstall preserves logs (optional)
- [ ] Install with pre-seeded config
- [ ] Install to custom directory

**Configuration Tests:**
- [ ] Wizard accepts valid dashboard URL
- [ ] Wizard rejects invalid URL format
- [ ] Wizard detects unreachable dashboard
- [ ] Wizard validates API key
- [ ] Wizard rejects invalid API key
- [ ] Config file permissions are correct
- [ ] Migration from .env to config.json

**Service Tests:**
- [ ] Service starts automatically on boot
- [ ] Service restarts after crash
- [ ] Service stops gracefully
- [ ] Service handles network disconnection
- [ ] Service reconnects after network restored
- [ ] Event log entries are created

**Functionality Tests:**
- [ ] ARP scanning works
- [ ] Ping sweep works
- [ ] Heartbeat sent to dashboard
- [ ] Device discovery reported
- [ ] Status checks performed
- [ ] Web UI accessible locally
- [ ] Logs written correctly

**Security Tests:**
- [ ] Config file not readable by standard users
- [ ] API key not exposed in process list
- [ ] API key not exposed in logs
- [ ] Service runs as LocalSystem
- [ ] Firewall rules applied correctly

### 9.3 Automated Testing

```powershell
# Automated test script (Pester)
Describe "IT Dashboard Agent Installation" {
    It "Installs without errors" {
        $result = Start-Process msiexec -ArgumentList '/i ITDashboardAgent.msi /qn' -Wait -PassThru
        $result.ExitCode | Should -Be 0
    }

    It "Creates service" {
        Get-Service -Name "ITDashboardAgent" | Should -Not -BeNullOrEmpty
    }

    It "Creates config directory" {
        Test-Path "C:\ProgramData\IT Dashboard Agent" | Should -Be $true
    }

    It "Executable runs" {
        $result = & "C:\Program Files\IT Dashboard Agent\it-dashboard-agent.exe" --version
        $result | Should -Match '\d+\.\d+\.\d+'
    }
}
```

---

## 10. Implementation Phases

### Phase 1: Core Packaging (Estimated: 3-4 days)

**Deliverables:**
1. Update `src/config.ts` to support JSON config file
2. Add CLI argument parsing for service commands
3. Create `pkg` configuration in package.json
4. Build script for creating Windows executable
5. Test executable runs standalone

**Tasks:**
- [ ] Add config.json loader alongside .env support
- [ ] Add command-line argument parser (using `commander` or `yargs`)
- [ ] Configure pkg with assets and targets
- [ ] Handle native module issues (net-snmp)
- [ ] Create build script `scripts/build-exe.js`
- [ ] Test on Windows 11 and Server 2022

### Phase 2: Windows Service Integration (Estimated: 2-3 days)

**Deliverables:**
1. Service installation/uninstallation commands
2. Service control (start/stop/restart)
3. Event log integration
4. Graceful shutdown handling

**Tasks:**
- [ ] Add `node-windows` dependency
- [ ] Create `src/service/service-manager.ts`
- [ ] Add --install-service, --uninstall-service flags
- [ ] Implement Windows Event Log logging
- [ ] Handle SIGTERM/SIGINT for graceful shutdown
- [ ] Test service installation and recovery

### Phase 3: Configuration Wizard (Estimated: 2-3 days)

**Deliverables:**
1. Interactive CLI configuration wizard
2. Connection validation
3. Config file generation
4. Migration tool for existing .env files

**Tasks:**
- [ ] Create `src/installer/config-wizard.ts`
- [ ] Add `inquirer` for interactive prompts
- [ ] Implement dashboard URL validation
- [ ] Implement API key validation
- [ ] Create config file writer
- [ ] Add .env to config.json migration
- [ ] Test wizard flow

### Phase 4: MSI Installer (Estimated: 3-4 days)

**Deliverables:**
1. WiX project configuration
2. MSI with UI and silent modes
3. Service registration
4. Upgrade support
5. Uninstaller

**Tasks:**
- [ ] Install WiX Toolset v4
- [ ] Create `installer/wix/Product.wxs`
- [ ] Define directory structure
- [ ] Add custom actions for service install
- [ ] Create MSI properties for silent install
- [ ] Add upgrade logic
- [ ] Test interactive and silent installs
- [ ] Test upgrade scenarios

### Phase 5: Polish & Documentation (Estimated: 2 days)

**Deliverables:**
1. Code signing setup
2. User documentation
3. Admin deployment guide
4. Build automation (GitHub Actions)

**Tasks:**
- [ ] Acquire code signing certificate (or use self-signed for testing)
- [ ] Create signing scripts
- [ ] Write end-user installation guide
- [ ] Write enterprise deployment guide
- [ ] Create GitHub Actions workflow for automated builds
- [ ] Generate SHA256 checksums for releases

### Timeline Summary

| Phase | Description | Estimated Duration |
|-------|-------------|-------------------|
| 1 | Core Packaging | 3-4 days |
| 2 | Windows Service | 2-3 days |
| 3 | Configuration Wizard | 2-3 days |
| 4 | MSI Installer | 3-4 days |
| 5 | Polish & Documentation | 2 days |
| **Total** | | **12-16 days** |

---

## 11. Alternative Approaches

### 11.1 Alternative: Electron-based Installer

**Pros:**
- Rich GUI for configuration
- Cross-platform installer generation
- Familiar web technologies

**Cons:**
- Much larger package size (150MB+)
- Overkill for a service application
- Higher resource usage

**Verdict:** Not recommended for this use case.

### 11.2 Alternative: Docker Container

**Pros:**
- Consistent environment
- Easy updates
- Platform independent

**Cons:**
- Requires Docker Desktop (licensing for enterprise)
- Windows containers are complex
- Network scanning from containers is limited
- Not typical for Windows service deployment

**Verdict:** Good for Linux servers, not ideal for Windows.

### 11.3 Alternative: Node.js Runtime Bundle

**Pros:**
- Simpler than pkg
- Smaller size (just Node.js + app)

**Cons:**
- Multiple files to manage
- PATH configuration needed
- Less clean than single executable

**Verdict:** Viable fallback if pkg has issues.

### 11.4 Alternative: NSSM (Current Approach)

**Pros:**
- Already documented
- Works reliably
- Simple setup

**Cons:**
- Requires manual Node.js installation
- No installer
- No configuration wizard
- Harder for non-technical users

**Verdict:** Acceptable for technical users, but the proposed solution is better for wider deployment.

### 11.5 Alternative: nexe Instead of pkg

**Pros:**
- Alternative to pkg
- Sometimes better ES Module support

**Cons:**
- Less maintained than pkg
- Similar limitations

**Verdict:** Consider as fallback if pkg doesn't work.

---

## Appendix A: Package.json Updates

```json
{
  "name": "it-dashboard-agent",
  "version": "1.0.0",
  "description": "Local network monitoring agent for IT Dashboard",
  "main": "dist/index.js",
  "bin": {
    "it-dashboard-agent": "dist/index.js"
  },
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc && npm run copy-static",
    "copy-static": "node -e \"const fs=require('fs');const path=require('path');fs.cpSync('src/ui/public','dist/ui/public',{recursive:true})\"",
    "start": "node dist/index.js",
    "build:exe": "npm run build && pkg . --target node22-win-x64 --output build/it-dashboard-agent.exe",
    "build:msi": "powershell -ExecutionPolicy Bypass -File scripts/build-msi.ps1"
  },
  "pkg": {
    "scripts": "dist/**/*.js",
    "assets": [
      "dist/ui/public/**/*",
      "node_modules/oui-data/**/*"
    ],
    "targets": [
      "node22-win-x64"
    ],
    "outputPath": "build"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "commander": "^12.0.0",
    "dotenv": "^16.3.0",
    "express": "^5.2.1",
    "inquirer": "^9.2.0",
    "net-snmp": "^3.26.1",
    "node-ssdp": "^4.0.1",
    "node-windows": "^1.0.0-beta.8",
    "oui": "^13.1.3",
    "oui-data": "^1.1.516",
    "socket.io": "^4.8.3",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.0",
    "@types/node": "^20.10.0",
    "pkg": "^5.8.1",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## Appendix B: WiX Product.wxs Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="IT Dashboard Agent"
    Version="1.0.0"
    Manufacturer="VelocityEU"
    UpgradeCode="PUT-GUID-HERE">

    <MajorUpgrade
      DowngradeErrorMessage="A newer version is already installed." />

    <MediaTemplate EmbedCab="yes" />

    <Feature Id="ProductFeature" Title="IT Dashboard Agent">
      <ComponentGroupRef Id="ProductComponents" />
      <ComponentGroupRef Id="ServiceComponents" />
    </Feature>

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="IT Dashboard Agent" />
    </StandardDirectory>

    <StandardDirectory Id="CommonAppDataFolder">
      <Directory Id="CONFIGFOLDER" Name="IT Dashboard Agent" />
    </StandardDirectory>

    <ComponentGroup Id="ProductComponents" Directory="INSTALLFOLDER">
      <Component Id="MainExecutable">
        <File Source="$(var.BuildDir)\it-dashboard-agent.exe" />
      </Component>
      <Component Id="Documentation">
        <File Source="LICENSE.txt" />
        <File Source="README.txt" />
      </Component>
    </ComponentGroup>

    <ComponentGroup Id="ServiceComponents" Directory="INSTALLFOLDER">
      <Component Id="ServiceInstaller">
        <ServiceInstall
          Id="ITDashboardAgentService"
          Name="ITDashboardAgent"
          DisplayName="IT Dashboard Agent"
          Description="Monitors network devices and reports to IT Dashboard"
          Start="auto"
          Type="ownProcess"
          ErrorControl="normal"
          Arguments="--service" />
        <ServiceControl
          Id="ITDashboardAgentServiceControl"
          Name="ITDashboardAgent"
          Start="install"
          Stop="both"
          Remove="uninstall"
          Wait="yes" />
      </Component>
    </ComponentGroup>
  </Package>
</Wix>
```

---

## Appendix C: Configuration Wizard Mockup

```
╔══════════════════════════════════════════════════════════════════════╗
║               IT Dashboard Agent - Configuration                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Welcome! This wizard will configure your IT Dashboard Agent.         ║
║                                                                       ║
║  You will need:                                                       ║
║    • Your IT Dashboard URL                                            ║
║    • An API key from the dashboard admin panel                        ║
║                                                                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  Step 1 of 4: Dashboard URL                                           ║
║──────────────────────────────────────────────────────────────────────║
║                                                                       ║
║  Enter your IT Dashboard URL:                                         ║
║  > https://it-dashboard-gray.vercel.app                               ║
║                                                                       ║
║  [■■■■■■■■■■] Validating...                                           ║
║                                                                       ║
║  ✓ Connection successful                                              ║
║  ✓ API endpoint responding                                            ║
║  ✓ TLS certificate valid                                              ║
║                                                                       ║
║  Press ENTER to continue...                                           ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  Step 2 of 4: API Key                                                 ║
║──────────────────────────────────────────────────────────────────────║
║                                                                       ║
║  Enter your Agent API Key:                                            ║
║  > agt_McoWVe_DOfX7O07kKxKBcnudNYe-Whdp                                ║
║                                                                       ║
║  [■■■■■■■■■■] Authenticating...                                       ║
║                                                                       ║
║  ✓ API key valid                                                      ║
║  ✓ Agent registered: "Office Network Agent"                           ║
║  ✓ 2 network segments assigned                                        ║
║                                                                       ║
║  Press ENTER to continue...                                           ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  Step 3 of 4: Agent Name                                              ║
║──────────────────────────────────────────────────────────────────────║
║                                                                       ║
║  Agent name (from dashboard): Office Network Agent                    ║
║                                                                       ║
║  Would you like to use a different name? [y/N]: n                     ║
║                                                                       ║
║  Using: Office Network Agent                                          ║
║                                                                       ║
║  Press ENTER to continue...                                           ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  Step 4 of 4: Review Configuration                                    ║
║──────────────────────────────────────────────────────────────────────║
║                                                                       ║
║  Please review your configuration:                                    ║
║                                                                       ║
║  Dashboard URL:    https://it-dashboard-gray.vercel.app               ║
║  API Key:          agt_McoWVe_*********************                   ║
║  Agent Name:       Office Network Agent                               ║
║  Heartbeat:        60 seconds                                         ║
║  Status Check:     30 seconds                                         ║
║  Log Level:        info                                               ║
║  Web UI Port:      3001                                               ║
║                                                                       ║
║  Save configuration and start service? [Y/n]: y                       ║
║                                                                       ║
║  ✓ Configuration saved to C:\ProgramData\IT Dashboard Agent\config.json
║  ✓ Windows Service started                                            ║
║  ✓ Agent is now monitoring your network!                              ║
║                                                                       ║
║  Web UI available at: http://localhost:3001                           ║
║                                                                       ║
║  Press any key to exit...                                             ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Decision Points for Discussion

Before implementation, the following decisions need to be made:

### 1. Packaging Tool
- **pkg** (recommended) - Mature, well-supported
- **nexe** - Alternative if pkg has ES Module issues
- **Node.js bundle** - Fallback option

### 2. Installer Technology
- **WiX Toolset v4** (recommended) - Industry standard for Windows MSI
- **Inno Setup** - Simpler, creates EXE installer instead of MSI
- **NSIS** - Another EXE installer option

### 3. Configuration Storage
- **JSON file** (recommended) - Easy to edit, parse, and validate
- **Windows Registry** - More "Windows native"
- **Encrypted with DPAPI** - Higher security

### 4. API Key Provisioning
- **Manual copy/paste** (current) - Simple, works now
- **Enrollment tokens** - Better for scale, requires dashboard changes
- **Domain integration** - Enterprise feature, most complex

### 5. Code Signing
- **Required** - For enterprise deployment
- **Self-signed** - For testing only
- **Skip initially** - Faster to market, add later

---

## Next Steps

1. **Review this plan** and provide feedback
2. **Make decisions** on the decision points above
3. **Prioritize** features for initial release
4. **Begin implementation** starting with Phase 1

---

*Document created: January 2026*
*Author: Claude (AI Assistant)*
*Version: 1.0*

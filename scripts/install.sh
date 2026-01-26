#!/usr/bin/env bash
#
# IT Dashboard Agent - Unix Installer
# One-line installer for IT Dashboard Agent on macOS and Linux.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.sh | bash
#
# Version: 1.0.0
# Author: Velocity EU

set -e

# Version and constants
VERSION="1.0.0"
INSTALL_PATH="/opt/it-dashboard-agent"
REPO_URL="https://github.com/velocityeu/it-dashboard-agent.git"
DEFAULT_DASHBOARD_URL="https://it-dashboard-gray.vercel.app"
SERVICE_NAME="it-dashboard-agent"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *)       OS="unknown" ;;
    esac
}

# Print functions
print_banner() {
    clear
    echo -e "${CYAN}"
    cat << 'EOF'

  _____ _____   ____            _     _                         _
 |_   _|_   _| |  _ \  __ _ ___| |__ | |__   ___   __ _ _ __ __| |
   | |   | |   | | | |/ _` / __| '_ \| '_ \ / _ \ / _` | '__/ _` |
   | |   | |   | |_| | (_| \__ \ | | | |_) | (_) | (_| | | | (_| |
  _|_|_ _|_|_  |____/ \__,_|___/_| |_|_.__/ \___/ \__,_|_|  \__,_|
 |  ___|_   _|     / \   __ _  ___ _ __ | |_
 | |_    | |      / _ \ / _` |/ _ \ '_ \| __|
 |  _|   | |     / ___ \ (_| |  __/ | | | |_
 |_|     |_|    /_/   \_\__, |\___|_| |_|\__|
                        |___/
EOF
    echo -e "                                                 v${VERSION} - ${OS^}"
    echo -e "${NC}"
}

print_step() {
    echo -e "${YELLOW}[$1/$2] $3${NC}"
}

print_success() {
    echo -e "${GREEN}[OK] $1${NC}"
}

print_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[WARN] $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_warning "This script requires root privileges for installation to /opt"
        print_warning "Please run with sudo:"
        echo ""
        echo "  curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.sh | sudo bash"
        echo ""
        exit 1
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_nodejs() {
    if command_exists node; then
        NODE_VERSION=$(node --version | sed 's/v\([0-9]*\).*/\1/')
        if [[ "$NODE_VERSION" -ge 18 ]]; then
            return 0
        fi
    fi
    return 1
}

# Install Node.js
install_nodejs() {
    print_warning "Node.js 18+ not found. Installing..."

    if [[ "$OS" == "macos" ]]; then
        # macOS: Use Homebrew
        if command_exists brew; then
            echo -e "${CYAN}Installing Node.js via Homebrew...${NC}"
            brew install node@20
            brew link node@20 --force --overwrite 2>/dev/null || true

            # Update PATH for this session
            export PATH="/usr/local/opt/node@20/bin:$PATH"
            export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

            if check_nodejs; then
                print_success "Node.js installed via Homebrew"
                return 0
            fi
        else
            print_warning "Homebrew not found. Installing via nvm..."
        fi
    fi

    # Linux: Try package manager first
    if [[ "$OS" == "linux" ]]; then
        # Detect package manager and distro
        if command_exists apt-get; then
            # Debian/Ubuntu: Use NodeSource
            echo -e "${CYAN}Installing Node.js via NodeSource...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs

            if check_nodejs; then
                print_success "Node.js installed via NodeSource"
                return 0
            fi
        elif command_exists dnf; then
            # Fedora/RHEL
            echo -e "${CYAN}Installing Node.js via dnf...${NC}"
            dnf module install -y nodejs:20

            if check_nodejs; then
                print_success "Node.js installed via dnf"
                return 0
            fi
        elif command_exists yum; then
            # CentOS/older RHEL
            echo -e "${CYAN}Installing Node.js via NodeSource...${NC}"
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            yum install -y nodejs

            if check_nodejs; then
                print_success "Node.js installed via NodeSource"
                return 0
            fi
        elif command_exists pacman; then
            # Arch Linux
            echo -e "${CYAN}Installing Node.js via pacman...${NC}"
            pacman -Sy --noconfirm nodejs npm

            if check_nodejs; then
                print_success "Node.js installed via pacman"
                return 0
            fi
        fi
    fi

    # Fallback: Use nvm (works on both Linux and macOS)
    echo -e "${CYAN}Installing Node.js via nvm...${NC}"

    # Install nvm
    export NVM_DIR="$HOME/.nvm"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

    # Load nvm
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    # Install Node.js 20
    nvm install 20
    nvm use 20
    nvm alias default 20

    if check_nodejs; then
        print_success "Node.js installed via nvm"
        return 0
    fi

    print_error "Failed to install Node.js"
    echo "Please install Node.js 18+ manually from https://nodejs.org"
    exit 1
}

# Get configuration from user
get_configuration() {
    echo ""
    echo -e "${CYAN}Configuration${NC}"
    echo -e "${CYAN}=============${NC}"

    # Dashboard URL
    if [[ -z "$DASHBOARD_URL" ]]; then
        read -p "Dashboard URL [$DEFAULT_DASHBOARD_URL]: " input_url
        DASHBOARD_URL="${input_url:-$DEFAULT_DASHBOARD_URL}"
    fi

    # API Key (secure input)
    if [[ -z "$API_KEY" ]]; then
        read -s -p "Agent API Key: " API_KEY
        echo ""
        if [[ -z "$API_KEY" ]]; then
            print_error "API Key is required"
            exit 1
        fi
    fi

    # Agent Name
    if [[ -z "$AGENT_NAME" ]]; then
        DEFAULT_NAME="$(hostname) Agent"
        read -p "Agent Name [$DEFAULT_NAME]: " input_name
        AGENT_NAME="${input_name:-$DEFAULT_NAME}"
    fi

    echo ""
}

# Check for existing installation
check_existing_install() {
    if [[ -d "$INSTALL_PATH" ]]; then
        echo ""
        print_warning "Existing installation detected at: $INSTALL_PATH"

        # Check service status
        if [[ "$OS" == "linux" ]] && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            print_warning "Service '$SERVICE_NAME' is running"
        elif [[ "$OS" == "macos" ]] && launchctl list | grep -q "com.itdashboard.agent"; then
            print_warning "Service 'com.itdashboard.agent' is loaded"
        fi

        echo ""
        echo -e "${CYAN}Options:${NC}"
        echo "  [U] Upgrade - Pull latest code and restart service"
        echo "  [R] Reconfigure - Update configuration only"
        echo "  [F] Fresh install - Remove and reinstall"
        echo "  [C] Cancel"
        echo ""

        read -p "Select option [U/R/F/C]: " choice
        case "${choice^^}" in
            U) INSTALL_MODE="upgrade" ;;
            R) INSTALL_MODE="reconfigure" ;;
            F) INSTALL_MODE="fresh" ;;
            *) INSTALL_MODE="cancel" ;;
        esac
    else
        INSTALL_MODE="new"
    fi
}

# Stop existing service
stop_service() {
    echo -e "${CYAN}Stopping existing service...${NC}"

    if [[ "$OS" == "linux" ]]; then
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    elif [[ "$OS" == "macos" ]]; then
        launchctl unload /Library/LaunchDaemons/com.itdashboard.agent.plist 2>/dev/null || true
    fi
}

# Remove existing installation
remove_existing() {
    stop_service

    echo -e "${CYAN}Removing existing installation...${NC}"

    # Remove service files
    if [[ "$OS" == "linux" ]]; then
        rm -f /etc/systemd/system/it-dashboard-agent.service
        systemctl daemon-reload
    elif [[ "$OS" == "macos" ]]; then
        rm -f /Library/LaunchDaemons/com.itdashboard.agent.plist
    fi

    # Remove installation directory
    rm -rf "$INSTALL_PATH"
}

# Clone repository
clone_repository() {
    echo -e "${CYAN}Cloning repository...${NC}"

    if ! command_exists git; then
        print_error "Git is not installed."
        if [[ "$OS" == "macos" ]]; then
            echo "Install with: xcode-select --install"
        elif [[ "$OS" == "linux" ]]; then
            echo "Install with: apt-get install git (or your package manager)"
        fi
        exit 1
    fi

    git clone --depth 1 "$REPO_URL" "$INSTALL_PATH"

    if [[ ! -f "$INSTALL_PATH/package.json" ]]; then
        print_error "Clone succeeded but package.json not found"
        exit 1
    fi

    print_success "Repository cloned"
}

# Update repository
update_repository() {
    echo -e "${CYAN}Pulling latest changes...${NC}"

    cd "$INSTALL_PATH"
    git fetch --depth 1 origin master
    git reset --hard origin/master

    print_success "Repository updated"
}

# Install dependencies
install_dependencies() {
    echo -e "${CYAN}Installing dependencies...${NC}"

    cd "$INSTALL_PATH"
    npm install || {
        print_error "npm install failed"
        exit 1
    }

    print_success "Dependencies installed"
}

# Build agent
build_agent() {
    echo -e "${CYAN}Building agent...${NC}"

    cd "$INSTALL_PATH"

    # Need dev dependencies for build
    npm install
    npm run build

    if [[ ! -f "$INSTALL_PATH/dist/index.js" ]]; then
        print_error "Build completed but dist/index.js not found"
        exit 1
    fi

    print_success "Agent built"
}

# Write .env file
write_env_file() {
    echo -e "${CYAN}Creating configuration file...${NC}"

    cat > "$INSTALL_PATH/.env" << EOF
# IT Dashboard Agent Configuration
# Generated by installer on $(date '+%Y-%m-%d %H:%M:%S')

DASHBOARD_URL=$DASHBOARD_URL
AGENT_API_KEY=$API_KEY
AGENT_NAME=$AGENT_NAME

# Optional settings
HEARTBEAT_INTERVAL=60000
STATUS_CHECK_INTERVAL=30000
LOG_LEVEL=info
EOF

    # Set secure permissions
    chmod 600 "$INSTALL_PATH/.env"

    print_success "Configuration file created with secure permissions"
}

# Install systemd service (Linux)
install_systemd_service() {
    echo -e "${CYAN}Creating systemd service...${NC}"

    NODE_PATH=$(which node)

    cat > /etc/systemd/system/it-dashboard-agent.service << EOF
[Unit]
Description=IT Dashboard Agent
Documentation=https://github.com/velocityeu/it-dashboard-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_PATH
ExecStart=$NODE_PATH $INSTALL_PATH/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=it-dashboard-agent
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"

    print_success "Systemd service created"
}

# Install launchd service (macOS)
install_launchd_service() {
    echo -e "${CYAN}Creating launchd service...${NC}"

    NODE_PATH=$(which node)

    # Create logs directory
    mkdir -p "$INSTALL_PATH/logs"

    cat > /Library/LaunchDaemons/com.itdashboard.agent.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.itdashboard.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$INSTALL_PATH/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_PATH</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_PATH/logs/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_PATH/logs/agent-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

    print_success "Launchd service created"
}

# Start service
start_service() {
    echo -e "${CYAN}Starting service...${NC}"

    if [[ "$OS" == "linux" ]]; then
        systemctl start "$SERVICE_NAME"
        sleep 3

        if systemctl is-active --quiet "$SERVICE_NAME"; then
            print_success "Service started"
        else
            print_error "Service failed to start"
            echo "Check logs with: journalctl -u $SERVICE_NAME -f"
            exit 1
        fi
    elif [[ "$OS" == "macos" ]]; then
        launchctl load /Library/LaunchDaemons/com.itdashboard.agent.plist
        sleep 3

        if launchctl list | grep -q "com.itdashboard.agent"; then
            print_success "Service started"
        else
            print_error "Service failed to start"
            echo "Check logs at: $INSTALL_PATH/logs/"
            exit 1
        fi
    fi
}

# Show completion message
show_completion() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${CYAN}Agent UI:    http://localhost:3001${NC}"

    if [[ "$OS" == "linux" ]]; then
        echo -e "${CYAN}Service:     $SERVICE_NAME (running)${NC}"
    elif [[ "$OS" == "macos" ]]; then
        echo -e "${CYAN}Service:     com.itdashboard.agent (running)${NC}"
    fi

    echo -e "${CYAN}Install Dir: $INSTALL_PATH${NC}"
    echo ""
    echo -e "${YELLOW}Useful commands:${NC}"

    if [[ "$OS" == "linux" ]]; then
        echo "  Start:   sudo systemctl start $SERVICE_NAME"
        echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
        echo "  Status:  sudo systemctl status $SERVICE_NAME"
        echo "  Logs:    journalctl -u $SERVICE_NAME -f"
    elif [[ "$OS" == "macos" ]]; then
        echo "  Start:   sudo launchctl load /Library/LaunchDaemons/com.itdashboard.agent.plist"
        echo "  Stop:    sudo launchctl unload /Library/LaunchDaemons/com.itdashboard.agent.plist"
        echo "  Logs:    tail -f $INSTALL_PATH/logs/agent.log"
    fi

    echo ""
    echo -e "${YELLOW}To uninstall, run:${NC}"
    echo "  curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/uninstall.sh | sudo bash"
    echo ""
}

# Main installation flow
main() {
    detect_os
    print_banner

    if [[ "$OS" == "unknown" ]]; then
        print_error "Unsupported operating system"
        exit 1
    fi

    check_root
    check_existing_install

    case "$INSTALL_MODE" in
        cancel)
            echo "Installation cancelled."
            exit 0
            ;;
        reconfigure)
            get_configuration
            write_env_file
            stop_service
            start_service
            show_completion
            exit 0
            ;;
        fresh)
            remove_existing
            ;;
    esac

    TOTAL_STEPS=7
    STEP=0

    # Step 1: Check Node.js
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Checking Node.js..."
    if check_nodejs; then
        print_success "Node.js $(node --version) found"
    else
        install_nodejs
    fi

    # Step 2: Clone or update repository
    STEP=$((STEP + 1))
    if [[ "$INSTALL_MODE" == "upgrade" ]]; then
        print_step $STEP $TOTAL_STEPS "Updating repository..."
        stop_service
        update_repository
    else
        print_step $STEP $TOTAL_STEPS "Cloning repository..."
        clone_repository
    fi

    # Step 3: Get configuration
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Configuring agent..."
    if [[ "$INSTALL_MODE" != "upgrade" ]] || [[ ! -f "$INSTALL_PATH/.env" ]]; then
        get_configuration
    else
        print_success "Using existing configuration"
    fi

    # Step 4: Install dependencies
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Installing dependencies..."
    install_dependencies

    # Step 5: Build agent
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Building agent..."
    build_agent

    # Step 6: Write config (only for new installs)
    if [[ "$INSTALL_MODE" != "upgrade" ]]; then
        write_env_file
    fi

    # Step 7: Install service
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Installing system service..."
    if [[ "$OS" == "linux" ]]; then
        install_systemd_service
    elif [[ "$OS" == "macos" ]]; then
        install_launchd_service
    fi

    # Step 8: Start service
    STEP=$((STEP + 1))
    print_step $STEP $TOTAL_STEPS "Starting service..."
    start_service

    show_completion
}

# Run main
main "$@"

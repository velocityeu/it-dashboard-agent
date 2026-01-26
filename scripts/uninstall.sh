#!/usr/bin/env bash
#
# IT Dashboard Agent - Unix Uninstaller
# Removes IT Dashboard Agent from macOS and Linux.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.sh | sudo bash
#
# Version: 1.0.0
# Author: Velocity EU

set -e

# Constants
INSTALL_PATH="/opt/it-dashboard-agent"
SERVICE_NAME="it-dashboard-agent"
KEEP_CONFIG=false
FORCE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-config)
            KEEP_CONFIG=true
            shift
            ;;
        --force|-f)
            FORCE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *)       OS="unknown" ;;
    esac
}

print_banner() {
    clear
    echo -e "${CYAN}"
    echo "  IT Dashboard Agent - Uninstaller"
    echo "  ================================="
    echo -e "${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${YELLOW}This script requires root privileges.${NC}"
        echo -e "${YELLOW}Please run with sudo:${NC}"
        echo ""
        echo "  curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.sh | sudo bash"
        echo ""
        exit 1
    fi
}

# Check service status
check_service() {
    if [[ "$OS" == "linux" ]]; then
        if systemctl list-unit-files | grep -q "$SERVICE_NAME"; then
            SERVICE_EXISTS=true
            if systemctl is-active --quiet "$SERVICE_NAME"; then
                SERVICE_STATUS="running"
            else
                SERVICE_STATUS="stopped"
            fi
        else
            SERVICE_EXISTS=false
        fi
    elif [[ "$OS" == "macos" ]]; then
        if [[ -f "/Library/LaunchDaemons/com.itdashboard.agent.plist" ]]; then
            SERVICE_EXISTS=true
            if launchctl list | grep -q "com.itdashboard.agent"; then
                SERVICE_STATUS="running"
            else
                SERVICE_STATUS="stopped"
            fi
        else
            SERVICE_EXISTS=false
        fi
    fi
}

# Stop service
stop_service() {
    echo -e "${CYAN}Stopping service...${NC}"

    if [[ "$OS" == "linux" ]]; then
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    elif [[ "$OS" == "macos" ]]; then
        launchctl unload /Library/LaunchDaemons/com.itdashboard.agent.plist 2>/dev/null || true
    fi
}

# Remove service
remove_service() {
    echo -e "${CYAN}Removing service files...${NC}"

    if [[ "$OS" == "linux" ]]; then
        rm -f /etc/systemd/system/it-dashboard-agent.service
        systemctl daemon-reload
    elif [[ "$OS" == "macos" ]]; then
        rm -f /Library/LaunchDaemons/com.itdashboard.agent.plist
    fi

    echo -e "${GREEN}[OK] Service removed${NC}"
}

# Remove installation directory
remove_installation() {
    echo -e "${CYAN}Removing installation directory...${NC}"

    if rm -rf "$INSTALL_PATH"; then
        echo -e "${GREEN}[OK] Directory removed${NC}"
    else
        echo -e "${YELLOW}[WARN] Could not fully remove directory${NC}"
        echo -e "${YELLOW}  You may need to manually delete: $INSTALL_PATH${NC}"
    fi
}

main() {
    detect_os
    print_banner

    if [[ "$OS" == "unknown" ]]; then
        echo -e "${RED}Unsupported operating system${NC}"
        exit 1
    fi

    check_root
    check_service

    # Check if installed
    if [[ "$SERVICE_EXISTS" != true ]] && [[ ! -d "$INSTALL_PATH" ]]; then
        echo -e "${YELLOW}IT Dashboard Agent is not installed.${NC}"
        echo -e "${GRAY}  Service: Not found${NC}"
        echo -e "${GRAY}  Path: $INSTALL_PATH (not found)${NC}"
        exit 0
    fi

    # Show what will be removed
    echo -e "${YELLOW}The following will be removed:${NC}"
    echo ""

    if [[ "$SERVICE_EXISTS" == true ]]; then
        if [[ "$OS" == "linux" ]]; then
            echo "  Service: $SERVICE_NAME ($SERVICE_STATUS)"
        elif [[ "$OS" == "macos" ]]; then
            echo "  Service: com.itdashboard.agent ($SERVICE_STATUS)"
        fi
    fi

    if [[ -d "$INSTALL_PATH" ]]; then
        echo "  Directory: $INSTALL_PATH"

        if [[ -f "$INSTALL_PATH/.env" ]]; then
            if [[ "$KEEP_CONFIG" == true ]]; then
                echo -e "  Config: ${GREEN}Will be preserved (backup)${NC}"
            else
                echo -e "  Config: ${RED}Will be deleted${NC}"
            fi
        fi
    fi

    echo ""

    # Confirm unless --force
    if [[ "$FORCE" != true ]]; then
        read -p "Are you sure you want to uninstall? [y/N]: " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Uninstall cancelled.${NC}"
            exit 0
        fi
    fi

    echo ""

    # Backup config if requested
    CONFIG_BACKUP=""
    if [[ "$KEEP_CONFIG" == true ]] && [[ -f "$INSTALL_PATH/.env" ]]; then
        echo -e "${CYAN}Backing up configuration...${NC}"
        CONFIG_BACKUP="$HOME/it-dashboard-agent.env.backup"
        cp "$INSTALL_PATH/.env" "$CONFIG_BACKUP"
        chmod 600 "$CONFIG_BACKUP"
        echo -e "${GRAY}  Saved to: $CONFIG_BACKUP${NC}"
    fi

    # Stop and remove service
    if [[ "$SERVICE_EXISTS" == true ]]; then
        stop_service
        remove_service
    fi

    # Remove installation directory
    if [[ -d "$INSTALL_PATH" ]]; then
        remove_installation
    fi

    # Success message
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Uninstall Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""

    if [[ -n "$CONFIG_BACKUP" ]]; then
        echo -e "${CYAN}Configuration backed up to:${NC}"
        echo "  $CONFIG_BACKUP"
        echo ""
        echo -e "${YELLOW}To reinstall with previous config, restore the .env file after installation.${NC}"
        echo ""
    fi

    echo -e "${CYAN}Thank you for using IT Dashboard Agent!${NC}"
    echo ""
}

# Run main
main "$@"

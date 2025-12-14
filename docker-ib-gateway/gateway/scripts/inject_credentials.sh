#!/bin/bash

#=============================================================================+
#                                                                             +
#   This script injects IB credentials from environment variables into the   +
#   IBC configuration file before Gateway starts.                            +
#                                                                             +
#=============================================================================+

CONFIG_FILE="${IBC_INI:-/opt/ibc/config.ini}"

echo "Injecting credentials into config file: $CONFIG_FILE"

# Check if environment variables are set
if [ -z "$IB_USERNAME" ]; then
    echo "Warning: IB_USERNAME environment variable not set. Credentials will not be injected."
    exit 0
fi

if [ -z "$IB_PASSWORD" ]; then
    echo "Warning: IB_PASSWORD environment variable not set. Credentials will not be injected."
    exit 0
fi

if [ "$TRADING_MODE" = "live" ] && [ -z "$IB_TWOFA_SECRET" ]; then
    echo "Warning: Live trading requested but IB_TWOFA_SECRET not set. 2FA may fail."
fi

# Inject username (IbLoginId)
echo "Setting IbLoginId..."
sed -i "s/^IbLoginId=.*/IbLoginId=$IB_USERNAME/" "$CONFIG_FILE"

# Inject password (IbPassword)
echo "Setting IbPassword..."
sed -i "s/^IbPassword=.*/IbPassword=$IB_PASSWORD/" "$CONFIG_FILE"

# Set trading mode if specified
if [ -n "$TRADING_MODE" ]; then
    echo "Setting TradingMode to: $TRADING_MODE"
    sed -i "s/^TradingMode=.*/TradingMode=$TRADING_MODE/" "$CONFIG_FILE"

    # If paper trading, automatically accept non-brokerage account warning
    if [ "$TRADING_MODE" = "paper" ]; then
        echo "Setting AcceptNonBrokerageAccountWarning=yes for paper trading"
        sed -i "s/^AcceptNonBrokerageAccountWarning=.*/AcceptNonBrokerageAccountWarning=yes/" "$CONFIG_FILE"
    fi
fi

echo "Credentials injected successfully!"

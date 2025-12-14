#!/bin/bash

#=============================================================================+
#                                                                             +
#   This script monitors for the Second Factor Authentication window and      +
#   injects the TOTP code generated from the IB_TWOFA_SECRET env var.         +
#                                                                             +
#=============================================================================+

if [ -z "$IB_TWOFA_SECRET" ]; then
    echo "IB_TWOFA_SECRET not set. 2FA automation disabled."
    exit 0
fi

echo "Starting 2FA monitoring..."

# Wait for the window to appear
while true; do
    # Search for the window with title "Second Factor Authentication"
    # Note: The title might vary slightly, so we search for substring.
    # We use xdotool search --name which matches window title.
    WID=$(xdotool search --name "Second Factor Authentication" 2>/dev/null | head -n 1)

    if [ -n "$WID" ]; then
        echo "2FA window found (ID: $WID). Generating code..."
        
        # Generate TOTP code
        CODE=$(oathtool --totp -b "$IB_TWOFA_SECRET")
        
        if [ -n "$CODE" ]; then
            echo "Injecting code..."
            
            # Focus the window
            xdotool windowactivate --sync "$WID"
            sleep 0.5
            
            # Type the code
            xdotool type "$CODE"
            sleep 0.5
            
            # Press Enter
            xdotool key Return
            
            echo "Code injected. Exiting 2FA monitor."
            exit 0
        else
            echo "Failed to generate TOTP code. Check your secret."
            exit 1
        fi
    fi
    
    sleep 2
done

import { describe, expect, it } from 'vitest'
import { reviewTerminalCommand } from './terminal-command-review.js'
describe('terminal convenience insertion review', () => {
  it.each(['ss -lntup','netstat -tuln','lsof -i','df -h','free -m','pwd','uname -a','ip addr show','systemctl status nginx','journalctl -n 50','grep "two words" file'])('allows plain queries: %s', command => expect(reviewTerminalCommand(command,'safe','LINUX')).toBe('safe'))
  it.each(['ss -K','ss -tK','sudo ss -lntup','echo hi; reboot','ps | sh','cat file > output','printf $(whoami)','python -c print(1)','custom-tool','date -s tomorrow','date 102314002026','hostname newname','rg --pre script hello','ip link set eth0 down','journalctl --vacuum-time=1s','systemctl restart nginx','Get-Process {Remove-Item x}'])('requires review for complex or mutating commands: %s', command => expect(reviewTerminalCommand(command,'safe')).toBe('approval_required'))
  it('preserves tenant denials even for a known query', () => {
    expect(reviewTerminalCommand('ss -lntup','blocked','LINUX')).toBe('blocked')
    expect(reviewTerminalCommand('ss -lntup','approval_required','LINUX')).toBe('approval_required')
  })
  it('checks the registered host platform, never browser platform', () => {
    expect(reviewTerminalCommand('Get-NetTCPConnection','safe','WINDOWS')).toBe('safe')
    expect(reviewTerminalCommand('Get-NetTCPConnection','safe','WINDOWS_SERVER')).toBe('safe')
    expect(reviewTerminalCommand('ss -lntup','safe','MACOS')).toBe('approval_required')
    expect(reviewTerminalCommand('lsof -i','safe','FREEBSD')).toBe('safe')
    expect(reviewTerminalCommand('Get-NetTCPConnection','safe','LINUX')).toBe('approval_required')
    expect(reviewTerminalCommand('ss -lntup','safe','WINDOWS')).toBe('approval_required')
    expect(reviewTerminalCommand('ss -lntup','safe','UNKNOWN')).toBe('safe')
  })
})

import { describe, it, expect } from 'bun:test';
import { parseRegQuery } from './windows';

describe('windows', () => {
  describe('parseRegQuery', () => {
    it('should group values under their registry keys', () => {
      const output = [
        '',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Helium',
        '    DisplayName    REG_SZ    Helium',
        '    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application',
        '    NoModify    REG_DWORD    0x1',
        '',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Discord',
        '    DisplayName    REG_SZ    Discord',
        '',
      ].join('\r\n');

      expect(parseRegQuery(output)).toEqual({
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Helium': {
          DisplayName: 'Helium',
          InstallLocation: 'C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application',
          NoModify: '0x1',
        },
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Discord': {
          DisplayName: 'Discord',
        },
      });
    });

    it('should keep values that contain spaces', () => {
      const output =
        'HKEY_LOCAL_MACHINE\\Software\\Test\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n';
      expect(Object.values(parseRegQuery(output))[0]).toEqual({
        '(Default)': 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      });
    });
  });
});

"""Owner-run Gmail eligibility check. Never sends email or changes Supabase.

Default prints a plan. --check-login prompts privately for an existing account
and its Google app password, authenticates once over verified TLS, then quits.
"""
import argparse
from getpass import getpass
import json
import re
import smtplib
import ssl


def check(address, password, factory=smtplib.SMTP_SSL):
    report = dict(login_requests=0, messages_sent=0, automatic_retries=False,
                  credentials_saved_or_printed=False, settings_changed=False)
    if not re.fullmatch(r'[A-Za-z0-9._%+\-]+@gmail\.com', address):
        return dict(report, status='STOP_EXISTING_PERSONAL_GMAIL_REQUIRED')
    password = password.replace(' ', '')
    if not re.fullmatch(r'[A-Za-z0-9]{16}', password):
        return dict(report, status='STOP_GOOGLE_APP_PASSWORD_FORMAT_NO_REQUEST')
    try:
        # No SMTP debug output, sendmail, send_message, MAIL FROM or RCPT TO.
        with factory('smtp.gmail.com', 465, timeout=15,
                     context=ssl.create_default_context()) as connection:
            connection.ehlo()
            report['login_requests'] = 1
            connection.login(address, password)
        return dict(report, status='PASS_AUTH_ONLY_DELIVERY_NOT_VERIFIED')
    except smtplib.SMTPAuthenticationError:
        return dict(report, status='STOP_AUTH_REJECTED_NO_RETRY')
    except Exception as error:
        return dict(report, status='STOP_NO_RETRY', error_type=type(error).__name__)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-login', action='store_true')
    args = parser.parse_args()
    if not args.check_login:
        print('PLAN ONLY: existing personal Gmail, 2-Step Verification and an eligible app password; verified TLS465, one auth attempt, zero email, no Supabase change.')
    else:
        print(json.dumps(check(getpass('Existing sender Gmail address (hidden): ').strip(),
                               getpass('Google app password (hidden; NOT normal account password): ')), indent=2))

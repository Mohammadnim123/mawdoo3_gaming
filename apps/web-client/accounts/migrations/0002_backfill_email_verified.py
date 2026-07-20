# Password logins now require a verified email (reference parity: signup
# activates the password via the emailed link). Accounts created before this
# gate existed never had a chance to verify — grandfather them in so nobody
# gets locked out by the deploy.
from django.db import migrations


def backfill(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(email_verified=False).update(email_verified=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]

import pytest
from pydantic import ValidationError
from app.api.identity import LoginInput, PasswordInput

@pytest.mark.parametrize('password', [' leading', 'trailing ', ' both ', '\tprivate\t', 'inside space'])
def test_login_preserves_exact_password(password):
    value = LoginInput(email=' ADMIN@EXAMPLE.COM ', password=password)
    assert value.password == password
    assert value.email == 'admin@example.com'

def test_login_rejects_empty_password():
    with pytest.raises(ValidationError):LoginInput(email='a@example.com', password='')

def test_new_password_has_twelve_character_minimum():
    with pytest.raises(ValidationError):PasswordInput(password='short')
    assert PasswordInput(password='synthetic-12').password == 'synthetic-12'

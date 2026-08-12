import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, type User } from '@payflow/database';
import { compare, hash } from 'bcryptjs';

import type { ApiEnvironment } from '../config/environment';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const now = new Date('2026-08-12T12:00:00.000Z');
  const user: User = {
    id: '7f74dc32-355b-4e96-b5ec-3ef0114dd001',
    email: 'buyer@example.com',
    passwordHash: '',
    role: Role.USER,
    createdAt: now,
  };
  let usersRepository: {
    createUser: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    usersRepository = {
      createUser: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
    const configService = {
      get: jest.fn().mockReturnValue(900),
    };

    service = new AuthService(
      usersRepository as unknown as UsersRepository,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService<ApiEnvironment, true>,
    );
  });

  it('registers only a USER and hashes the password', async () => {
    usersRepository.findByEmail.mockResolvedValue(null);
    usersRepository.createUser.mockImplementation(
      (email: string, passwordHash: string) => ({
        ...user,
        email,
        passwordHash,
      }),
    );

    const result = await service.register({
      email: user.email,
      password: 'Reliable-payments-2026!',
    });

    const [, passwordHash] = usersRepository.createUser.mock.calls[0] as [
      string,
      string,
    ];
    expect(passwordHash).not.toBe('Reliable-payments-2026!');
    await expect(
      compare('Reliable-payments-2026!', passwordHash),
    ).resolves.toBe(true);
    expect(result).toEqual({
      accessToken: 'signed.jwt',
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        role: 'USER',
        createdAt: now.toISOString(),
      },
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: user.id,
      role: 'USER',
    });
  });

  it('rejects duplicate email registration', async () => {
    usersRepository.findByEmail.mockResolvedValue(user);

    await expect(
      service.register({
        email: user.email,
        password: 'Reliable-payments-2026!',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(usersRepository.createUser).not.toHaveBeenCalled();
  });

  it('rejects a password that bcrypt would silently truncate', async () => {
    await expect(
      service.register({
        email: user.email,
        password: '密'.repeat(25),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    expect(usersRepository.createUser).not.toHaveBeenCalled();
  });

  it('authenticates a valid password and rejects an invalid one', async () => {
    const passwordHash = await hash('Reliable-payments-2026!', 4);
    usersRepository.findByEmail.mockResolvedValue({ ...user, passwordHash });

    await expect(
      service.login({
        email: user.email,
        password: 'Reliable-payments-2026!',
      }),
    ).resolves.toMatchObject({
      accessToken: 'signed.jwt',
      user: { role: 'USER' },
    });

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

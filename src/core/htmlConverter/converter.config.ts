import { registerAs } from '@nestjs/config';

export default registerAs('html_converter', () => ({
  logo: '',
  playStore: '',
  appStore: '',
}));

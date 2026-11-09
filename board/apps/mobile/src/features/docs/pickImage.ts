// 노트에 넣을 사진 고르기 → 올리기(웹 note-editor 의 이미지 넣기). 사진 보관함에서 한 장, 서버가 받는 형식(PNG·JPEG·GIF·WebP·AVIF)만.
// iOS 기본 HEIC 는 서버가 받지 않아서 JPEG 로 받아요. 받은 주소(/api/files/…)를 노트에 ![](주소) 로 넣어요.
// 시스템 사진 고르기(PHPicker)는 앱 밖에서 돌아 보관함 접근 허락이 필요 없어요. 그래서 허락을 묻지 않아요(고른 사진만 앱에 와요).
import * as ImagePicker from 'expo-image-picker'
import { docsApi, IMAGE_TYPES } from '../../api/docs'
import { errorMessage, type ScopedClient } from '../../api/client'

export async function pickAndUpload(scope: ScopedClient): Promise<string | null> {
  // compatible: 사진 고르기가 HEIC 를 JPEG 로 바꿔 넘겨요(기본 current 는 HEIC 그대로라 서버가 거절해요)
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsMultipleSelection: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  })
  if (r.canceled || !r.assets[0]) return null
  const asset = r.assets[0]
  const type = asset.mimeType ?? 'image/jpeg'
  if (!IMAGE_TYPES.includes(type)) throw new Error('이 사진 형식은 올릴 수 없어요(PNG·JPEG·GIF·WebP·AVIF)')
  try {
    return (await docsApi.uploadImage(scope, asset.uri, type)).url
  } catch (e) {
    throw new Error(`사진을 올리지 못했어요: ${errorMessage(e)}`)
  }
}

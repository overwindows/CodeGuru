import os
import argparse
import image_extraction


def main():
    script_path = os.path.realpath(__file__)
    parser = argparse.ArgumentParser()
    parser.add_argument('docx_path', help='Path to the design document to analyze.')
    parser.add_argument(
        '-i', '--image_path',
        default=os.path.join(script_path, '..', 'images', 'extracted'), help='Path to image output.')
    parser.add_argument(
        '-o', '--output_path',
        default=os.path.join(script_path, '..', 'output'), help='Path to code output.')
    args = parser.parse_args()

    if not os.path.exists(args.docx_path):
        print('The design document path {} does not exist.'.format(args.docx_path))
        return

    print('Creating output paths...')
    os.makedirs(args.image_path, exist_ok=True)
    os.makedirs(args.output_path, exist_ok=True)
    print('Created output paths')

    print('Extracting images...')
    image_extraction.extract(args.docx_path, args.image_path)
    print('Extracted images to {}'.format(args.image_path))


if __name__ == "__main__":
    main()

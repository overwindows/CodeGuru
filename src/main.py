import os
import argparse
import azure_openai
import image_extraction
import word_to_markdown


def main():
    script_path = os.path.realpath(__file__)
    proj_root = os.path.dirname(os.path.dirname(script_path))
    parser = argparse.ArgumentParser()
    parser.add_argument('docx_path', help='Path to the design document to analyze.')
    parser.add_argument(
        '-m', '--markdown_path',
        default=os.path.join(proj_root, 'docs', 'markdown'), help='Path to markdown output.')
    parser.add_argument(
        '-i', '--image_path',
        default=os.path.join(proj_root, 'images', 'extracted'), help='Path to image output.')
    parser.add_argument(
        '-o', '--output_path',
        default=os.path.join(proj_root, 'output'), help='Path to code output.')
    args = parser.parse_args()

    if not os.path.exists(args.docx_path):
        print('The design document path {} does not exist.'.format(args.docx_path))
        return

    print('Creating output paths...')
    os.makedirs(args.markdown_path, exist_ok=True)
    os.makedirs(args.image_path, exist_ok=True)
    os.makedirs(args.output_path, exist_ok=True)
    print('Created output paths')

    print('Converting docx to markdown...')
    word_to_markdown.extract(args.docx_path, args.markdown_path)
    print(f'Converted markdown to {args.markdown_path}')

    print('Extracting images...')
    image_extraction.extract(args.docx_path, args.image_path)
    print('Extracted images to {}'.format(args.image_path))


if __name__ == "__main__":
    main()
